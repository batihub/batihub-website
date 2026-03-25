// crypto.js — End-to-end encryption for ChatHub
//
// Algorithm stack (all WebCrypto, zero dependencies):
//   Key agreement : ECDH P-256
//   Key derivation: HKDF-SHA-256
//   Encryption    : AES-256-GCM  (random 96-bit IV per message)
//
// DM rooms  — Static ECDH: Alice and Bob each derive the same AES key from
//             their long-term key pairs (ECDH(alicePriv, bobPub) ==
//             ECDH(bobPriv, alicePub)).  No server involvement beyond
//             relaying public keys.
//
// Group rooms — ECIES: the room creator generates a random AES-256-GCM room
//               key, then wraps it separately for every member using an
//               ephemeral ECDH key pair + HKDF. The server stores opaque
//               ciphertext bundles; it cannot read the room key.
//
// Wire format for encrypted messages:
//   "ENC:" + JSON.stringify({ iv: "<base64>", ct: "<base64>" })
// Any message NOT starting with "ENC:" is treated as legacy plaintext.

const E2EE = (() => {

    // ── Constants ──────────────────────────────────────────────────────────────
    const DB_NAME = 'e2ee_v1';
    const DB_VER  = 1;
    const STORE   = 'keypairs';
    const PFX     = 'ENC:';

    // ── Module-level state ─────────────────────────────────────────────────────
    let _token       = null;
    let _apiUrl      = null;
    let _username    = null;
    let _myKP        = null;    // { privateKey, publicKey } CryptoKey objects
    let _myPubJwk    = null;    // exported JWK of my public key
    let _ready       = false;

    // Key caches (cleared on reset())
    const _dmKeys    = {};   // partnerUsername → CryptoKey (AES-GCM)
    const _groupKeys = {};   // roomId → CryptoKey (AES-GCM)
    const _pubKeys   = {};   // username → CryptoKey (ECDH public, imported)


    // ── IndexedDB helpers ──────────────────────────────────────────────────────

    function _openDB() {
        return new Promise((res, rej) => {
            const req = indexedDB.open(DB_NAME, DB_VER);
            req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
            req.onsuccess = e => res(e.target.result);
            req.onerror   = e => rej(e.target.error);
        });
    }

    async function _idbGet(key) {
        const db = await _openDB();
        return new Promise((res, rej) => {
            const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            r.onsuccess = e => res(e.target.result ?? null);
            r.onerror   = e => rej(e.target.error);
        });
    }

    async function _idbSet(key, val) {
        const db = await _openDB();
        return new Promise((res, rej) => {
            const r = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
            r.onsuccess = () => res();
            r.onerror   = e  => rej(e.target.error);
        });
    }


    // ── Base64 helpers ─────────────────────────────────────────────────────────

    const _b64   = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const _unb64 = s   => Uint8Array.from(atob(s), c => c.charCodeAt(0));


    // ── Key generation & init ──────────────────────────────────────────────────

    /**
     * Call on every login (or page load with an existing session).
     * Safe to call multiple times — idempotent.
     */
    async function init(username, token, apiUrl) {
        _token  = token;
        _apiUrl = apiUrl;

        // Already initialized for this user — just refresh token/url
        if (_ready && _username === username) return;

        _username = username;
        _ready    = false;

        // Try loading existing key pair from IndexedDB
        const stored = await _idbGet(`kp:${username}`);
        if (stored) {
            _myKP = {
                privateKey: await crypto.subtle.importKey(
                    'jwk', stored.privJwk,
                    { name: 'ECDH', namedCurve: 'P-256' },
                    false,                  // non-extractable on reimport
                    ['deriveKey', 'deriveBits']
                ),
                publicKey: await crypto.subtle.importKey(
                    'jwk', stored.pubJwk,
                    { name: 'ECDH', namedCurve: 'P-256' },
                    true, []
                ),
            };
            _myPubJwk = stored.pubJwk;
        } else {
            // Generate a new ECDH P-256 key pair
            _myKP = await crypto.subtle.generateKey(
                { name: 'ECDH', namedCurve: 'P-256' },
                true,                       // extractable so we can store it
                ['deriveKey', 'deriveBits']
            );
            _myPubJwk       = await crypto.subtle.exportKey('jwk', _myKP.publicKey);
            const privJwk   = await crypto.subtle.exportKey('jwk', _myKP.privateKey);
            await _idbSet(`kp:${username}`, { pubJwk: _myPubJwk, privJwk });
        }

        _ready = true;

        // Upload public key to server — PUT is idempotent, safe to repeat
        try {
            await fetch(`${_apiUrl}/users/me/public-key`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_token}`,
                },
                body: JSON.stringify({ public_key: JSON.stringify(_myPubJwk) }),
            });
        } catch (e) {
            console.warn('[E2EE] Public key upload failed (will retry on next login):', e.message);
        }
    }


    // ── Fetch & import a remote user's ECDH public key ────────────────────────

    async function _getPubKey(username) {
        // Own key is already in memory
        if (username === _username) return _myKP?.publicKey ?? null;
        if (_pubKeys[username]) return _pubKeys[username];

        try {
            const res = await fetch(
                `${_apiUrl}/users/${encodeURIComponent(username)}/public-key`,
                { headers: { 'Authorization': `Bearer ${_token}` } }
            );
            if (!res.ok) return null;
            const { public_key } = await res.json();
            if (!public_key) return null;

            const key = await crypto.subtle.importKey(
                'jwk', JSON.parse(public_key),
                { name: 'ECDH', namedCurve: 'P-256' },
                false, []
            );
            _pubKeys[username] = key;
            return key;
        } catch (e) {
            return null;
        }
    }


    // ── HKDF: ECDH shared bits → AES-256-GCM key ──────────────────────────────

    async function _hkdf(sharedBits, info) {
        const base = await crypto.subtle.importKey(
            'raw', sharedBits, 'HKDF', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: new Uint8Array(32),               // static zero salt; info provides domain sep
                info: new TextEncoder().encode(info),
            },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }


    // ── AES-GCM encrypt / decrypt ─────────────────────────────────────────────

    async function _aesEncrypt(key, plaintext) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            new TextEncoder().encode(plaintext)
        );
        return PFX + JSON.stringify({ iv: _b64(iv), ct: _b64(ct) });
    }

    async function _aesDecrypt(key, payload) {
        const { iv, ct } = JSON.parse(payload.slice(PFX.length));
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: _unb64(iv) },
            key,
            _unb64(ct)
        );
        return new TextDecoder().decode(plain);
    }


    // ── DM key derivation (static ECDH) ───────────────────────────────────────

    async function _getDMKey(partner) {
        if (_dmKeys[partner]) return _dmKeys[partner];
        if (!_myKP) return null;

        const theirPub = await _getPubKey(partner);
        if (!theirPub) return null;

        const bits = await crypto.subtle.deriveBits(
            { name: 'ECDH', public: theirPub },
            _myKP.privateKey,
            256
        );
        const key = await _hkdf(bits, 'chat-dm-v1');
        _dmKeys[partner] = key;
        return key;
    }


    // ── Group room key (ECIES) ─────────────────────────────────────────────────

    /**
     * Fetch and decrypt my ECIES-wrapped group key from the server.
     * Returns null if no bundle exists yet (room hasn't been keyed).
     */
    async function loadGroupKey(roomId) {
        if (_groupKeys[roomId]) return _groupKeys[roomId];
        if (!_myKP) return null;

        try {
            const res = await fetch(`${_apiUrl}/rooms/${roomId}/my-key`, {
                headers: { 'Authorization': `Bearer ${_token}` },
            });
            if (!res.ok) return null;
            const { encrypted_key } = await res.json();
            if (!encrypted_key) return null;

            const b = JSON.parse(encrypted_key);
            // b = { ephemeral_pub: JWK, iv: base64, ct: base64 }

            const ephPub = await crypto.subtle.importKey(
                'jwk', b.ephemeral_pub,
                { name: 'ECDH', namedCurve: 'P-256' },
                false, []
            );
            const bits    = await crypto.subtle.deriveBits(
                { name: 'ECDH', public: ephPub },
                _myKP.privateKey,
                256
            );
            const wrapKey = await _hkdf(bits, 'chat-group-wrap-v1');
            const rawKey  = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: _unb64(b.iv) },
                wrapKey,
                _unb64(b.ct)
            );
            const aesKey  = await crypto.subtle.importKey(
                'raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
            );
            _groupKeys[roomId] = aesKey;
            return aesKey;
        } catch (e) {
            console.warn('[E2EE] loadGroupKey failed:', e.message);
            return null;
        }
    }

    /**
     * Generate a new room key and distribute it to all members via ECIES.
     * Should only be called by the room owner when no key bundle exists yet.
     * Each member gets their own ECIES bundle (ephemeral pub + wrapped key).
     */
    async function distributeGroupKey(roomId, memberUsernames) {
        if (!_myKP || !memberUsernames.length) return false;

        // Generate fresh 256-bit room key
        const roomKey    = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
        );
        const rawRoomKey = await crypto.subtle.exportKey('raw', roomKey);

        const bundles = {};
        for (const username of memberUsernames) {
            try {
                const memberPub = await _getPubKey(username);
                if (!memberPub) {
                    console.warn(`[E2EE] No public key for ${username}, skipping`);
                    continue;
                }
                // Fresh ephemeral key pair per member — leaking one doesn't help others
                const ephKP = await crypto.subtle.generateKey(
                    { name: 'ECDH', namedCurve: 'P-256' },
                    true,
                    ['deriveKey', 'deriveBits']
                );
                const bits    = await crypto.subtle.deriveBits(
                    { name: 'ECDH', public: memberPub },
                    ephKP.privateKey,
                    256
                );
                const wrapKey  = await _hkdf(bits, 'chat-group-wrap-v1');
                const iv       = crypto.getRandomValues(new Uint8Array(12));
                const ct       = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv }, wrapKey, rawRoomKey
                );
                const ephPubJwk = await crypto.subtle.exportKey('jwk', ephKP.publicKey);

                bundles[username] = {
                    ephemeral_pub: ephPubJwk,
                    iv: _b64(iv),
                    ct: _b64(ct),
                };
            } catch (e) {
                console.warn(`[E2EE] Key wrapping failed for ${username}:`, e.message);
            }
        }

        if (!Object.keys(bundles).length) return false;

        try {
            await fetch(`${_apiUrl}/rooms/${roomId}/key-bundles`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_token}`,
                },
                body: JSON.stringify({ bundles }),
            });
            _groupKeys[roomId] = roomKey;
            return true;
        } catch (e) {
            console.warn('[E2EE] distributeGroupKey upload failed:', e.message);
            return false;
        }
    }


    // ── Public API ─────────────────────────────────────────────────────────────

    async function encryptDM(text, partner) {
        if (!_ready) return text;
        const key = await _getDMKey(partner).catch(() => null);
        if (!key) return text;                          // no key → graceful plaintext
        return _aesEncrypt(key, text).catch(() => text);
    }

    async function decryptDM(payload, partner) {
        if (!payload.startsWith(PFX)) return payload;  // legacy plaintext
        const key = await _getDMKey(partner).catch(() => null);
        if (!key) return '[Encrypted — key unavailable]';
        return _aesDecrypt(key, payload).catch(() => '[Could not decrypt message]');
    }

    async function encryptGroup(text, roomId) {
        if (!_ready) return text;
        const key = await loadGroupKey(roomId).catch(() => null);
        if (!key) return text;
        return _aesEncrypt(key, text).catch(() => text);
    }

    async function decryptGroup(payload, roomId) {
        if (!payload.startsWith(PFX)) return payload;
        const key = await loadGroupKey(roomId).catch(() => null);
        if (!key) return '[Encrypted — key unavailable]';
        return _aesDecrypt(key, payload).catch(() => '[Could not decrypt message]');
    }

    /** Call on logout to drop all cached key material from memory. */
    function reset() {
        _token    = null;
        _apiUrl   = null;
        _ready    = false;
        _myKP     = null;
        _myPubJwk = null;
        Object.keys(_dmKeys).forEach(k    => delete _dmKeys[k]);
        Object.keys(_groupKeys).forEach(k => delete _groupKeys[k]);
        Object.keys(_pubKeys).forEach(k   => delete _pubKeys[k]);
    }

    return { init, loadGroupKey, distributeGroupKey, encryptDM, decryptDM, encryptGroup, decryptGroup, reset };

})();
