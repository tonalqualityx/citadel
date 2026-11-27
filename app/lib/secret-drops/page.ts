/**
 * The page Mike opens from a secret drop link (lib/secret-drops/drops.ts). Plain HTML with one small script: it encrypts the pasted key in the
 * browser to the drop's public key before anything is sent, then watches until the Bast machine says the key is stored.
 */
import { randomBytes } from 'crypto';
import { VALUE_MAX, type PublicView } from './drops';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** JSON safe to put inside a <script type="application/json"> block. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

const STYLE = `body{margin:0;font:18px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f5f2;color:#1d1d1f}
main{max-width:34rem;margin:0 auto;padding:2.5rem 1.25rem}
.card{background:#fff;border-radius:14px;padding:1.5rem;border-left:6px solid var(--tone,#2f6f4f);box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:1.4rem;line-height:1.3;margin:0 0 .75rem}
p{margin:.5rem 0}.small{color:#555;font-size:1rem}
code{font-size:.95rem;background:#f0efe9;padding:.1rem .35rem;border-radius:5px}
textarea{box-sizing:border-box;width:100%;min-height:6.5rem;font:16px/1.4 ui-monospace,Menlo,monospace;padding:.7rem;border:2px solid #1d1d1f;border-radius:10px;margin-top:.75rem}
button{font:inherit;font-weight:600;padding:.8rem 1.4rem;border-radius:10px;border:0;background:#2f6f4f;color:#fff;cursor:pointer;width:100%;margin-top:1rem}
button:disabled{opacity:.55}
#m{margin-top:1rem;font-weight:600}
#m.ok{color:#2f6f4f;font-size:1.5rem}#m.bad{color:#a33a2b}#m.wait{color:#8a6d1f}`;

export function pageHeaders(nonce: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
  };
}

export function newNonce(): string {
  return randomBytes(16).toString('base64');
}

function shell(title: string, tone: string, body: string, status: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${STYLE}</style></head><body data-status="${esc(status)}"><main><div class="card" style="--tone:${tone}">${body}</div></main></body></html>`;
}

// The browser half. Kept small and readable: import the drop's public key, encrypt the key with a fresh AES-GCM key, wrap that with RSA-OAEP-256,
// send only the result, clear the box, then ask every two seconds until the machine says stored.
const SCRIPT = `(function(){
var url=location.pathname,m=document.getElementById('m'),f=document.getElementById('f'),v=document.getElementById('v'),b=document.getElementById('b');
function show(c,t){m.className=c;m.textContent=t;}
function b64u(buf){var s='',a=new Uint8Array(buf);for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
function poll(){var n=0;(function tick(){fetch(url,{headers:{Accept:'application/json'},cache:'no-store',credentials:'omit'}).then(function(r){return r.json();}).then(function(j){
if(j.status==='stored'){show('ok','Stored');var d=document.getElementById('done');if(d)d.hidden=false;return;}
if(j.status==='failed'){show('bad','The machine could not store it: '+(j.failed_reason||'no reason given')+'. Nothing was kept. Ask Bast for a new link.');return;}
n++;if(n===45)show('wait','Received. The machine will store it shortly. You can close this page.');setTimeout(tick,n<45?2000:10000);
}).catch(function(){setTimeout(tick,5000);});})();}
if(document.body.getAttribute('data-status')==='received'){show('wait','Received. Storing it now…');poll();return;}
if(!f)return;
if(!window.crypto||!crypto.subtle){show('bad','This browser cannot encrypt the key here, so nothing was sent.');b.disabled=true;return;}
var pk=JSON.parse(document.getElementById('pk').textContent);
f.addEventListener('submit',function(e){e.preventDefault();var value=v.value.trim();
if(!value){show('bad','Paste the key first.');return;}
if(value.length>${VALUE_MAX}){show('bad','That is longer than any key this link takes. Nothing was sent.');return;}
b.disabled=true;show('wait','Encrypting on this phone…');
(async function(){try{
var rsa=await crypto.subtle.importKey('jwk',{kty:'RSA',n:pk.n,e:pk.e,alg:'RSA-OAEP-256',ext:true},{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
var aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
var iv=crypto.getRandomValues(new Uint8Array(12));
var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},aes,new TextEncoder().encode(value));
var ek=await crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,await crypto.subtle.exportKey('raw',aes));
value='';v.value='';
var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({v:1,ek:b64u(ek),iv:b64u(iv),ct:b64u(ct)}),credentials:'omit',referrerPolicy:'no-referrer'});
var j=await r.json();
if(!r.ok){show('bad',j.message||'Not sent.');return;}
f.hidden=true;show('wait','Sent, encrypted. Waiting for the Bast machine to store it…');poll();
}catch(err){show('bad','Could not encrypt the key on this phone. Nothing was sent.');b.disabled=false;}})();});
})();`;

export function dropPage(v: PublicView, nonce: string): { html: string; status: number } {
  const script = `<script nonce="${esc(nonce)}">${SCRIPT}</script>`;
  if (!v.ok || v.status === 'altered') {
    return { status: 400, html: shell('This link is not valid', '#a33a2b', `<h1>This link is not valid</h1><p>It does not match a link Citadel made. Nothing was sent.</p>`, 'altered') };
  }
  const label = esc(v.label ?? v.key_name ?? 'the key');
  const name = `<code>${esc(v.key_name ?? '')}</code>`;
  switch (v.status) {
    case 'expired':
      return { status: 410, html: shell('This link has expired', '#a33a2b', `<h1>This link has expired</h1><p>Nothing was sent. Ask Bast for a new link for ${label}.</p>`, 'expired') };
    case 'stored':
      return { status: 200, html: shell('Stored', '#2f6f4f', `<h1>Stored</h1><p>${label} is stored on the Bast machine under ${name}. You can close this page.</p>`, 'stored') };
    case 'failed':
      return {
        status: 200,
        html: shell('Not stored', '#a33a2b', `<h1>Not stored</h1><p>The machine could not store it: ${esc(v.failed_reason ?? 'no reason given')}. Nothing was kept. Ask Bast for a new link.</p>`, 'failed'),
      };
    case 'received':
      return {
        status: 200,
        html: shell('Storing it', '#8a6d1f', `<h1>Storing ${label}</h1><p class="small">It reached Citadel encrypted and waits for the Bast machine.</p><p id="m"></p><p id="done" class="small" hidden>You can close this page.</p>${script}`, 'received'),
      };
    default: {
      const replaces = v.replaces_existing ? `<p class="small">This replaces the key already stored under that name.</p>` : '';
      return {
        status: 200,
        html: shell(
          `Hand over ${v.label ?? v.key_name ?? 'a key'}`,
          '#2f6f4f',
          `<h1>Hand over ${label}</h1><p>Paste it below. This phone encrypts it before it leaves, so only the Bast machine can read it. It is stored under ${name}.</p>${replaces}` +
            `<form id="f" autocomplete="off"><label class="small" for="v">The key</label><textarea id="v" name="v" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" required></textarea><button id="b" type="submit">Store it</button></form>` +
            `<p id="m" role="status" aria-live="polite"></p><p id="done" class="small" hidden>You can close this page.</p>` +
            `<script type="application/json" id="pk">${scriptJson(v.public_key)}</script>${script}`,
          'waiting',
        ),
      };
    }
  }
}
