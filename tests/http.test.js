import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { vault, passwordVerifier, randomToken, hashToken } from '../src/security.js';
import { makePublisher } from '../src/publisher.js';
import { memoryStore, config, post } from './helpers.js';
async function fixture(){
 const store=memoryStore([post()]),v=vault(config.encryptionKey),auth=randomToken();await store.addSession(hashToken(auth),new Date(Date.now()+600000));let sent=0;
 const reddit={exchange:async()=>({access_token:'access',refresh_token:'never-send-this-to-browser'}),refresh:async()=>({access_token:'access'}),read:async path=>path==='/api/v1/me'?{name:'owner_reddit'}:{data:{is_flair_required:false}},submit:async()=>{sent++;return {status:'published',url:'https://www.reddit.com/r/test/comments/one'};},revoke:async()=>true};
 const publisher=makePublisher({store,config,reddit,vault:v});
 const app=await createApp({store,config,reddit,publisher,vault:v,verifyPassword:await passwordVerifier('long-test-password')});
 function request(path,{method='GET',body,authenticated=true,origin=config.origin,headers={}}={}){return app(new Request(config.origin+path,{method,headers:{...(authenticated?{Cookie:'tp_session='+auth}:{}),...(!['GET','HEAD'].includes(method)?{Origin:origin}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));}
 return {store,app,request,v,get sent(){return sent;}};
}
test('public preview loads but private state ignores forged identity headers',async()=>{
 const f=await fixture();const home=await f.request('/',{authenticated:false});assert.equal(home.status,200);assert.match(await home.text(),/Threadpilot/);
 assert.equal((await f.request('/api/state',{authenticated:false,headers:{'oai-authenticated-user-id':'owner'}})).status,401);
 assert.equal((await f.request('/api/run-due',{method:'POST',body:{},authenticated:false})).status,401);
 assert.equal((await f.request('/healthz',{authenticated:false})).status,200);
});
test('authenticated saves require same origin, revision and valid data',async()=>{
 const f=await fixture(),body={revision:0,posts:[post()],communities:['SideProject'],paused:false};
 assert.equal((await f.request('/api/state',{method:'PUT',body,origin:'https://evil.example'})).status,403);
 assert.equal((await f.request('/api/state',{method:'PUT',body})).status,200);
 assert.equal((await f.request('/api/state',{method:'PUT',body})).status,409);
 const data=await(await f.request('/api/state')).json();assert.equal(data.revision,1);assert.equal('encryptedRefreshToken' in data,false);
});
test('owner login creates secure revocable sessions and rejects cross-site login',async()=>{
 const f=await fixture();assert.equal((await f.request('/api/login',{method:'POST',body:'password=long-test-password',authenticated:false,origin:'https://evil.example'})).status,403);
 const login=await f.request('/api/login',{method:'POST',body:'password=long-test-password',authenticated:false});assert.equal(login.status,303);const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Secure/);
 const authCookie=cookie.split(';')[0];assert.equal((await f.request('/api/state',{authenticated:false,headers:{Cookie:authCookie}})).status,200);
 assert.equal((await f.request('/api/logout',{method:'POST',body:{},authenticated:false,headers:{Cookie:authCookie}})).status,200);
 assert.equal((await f.request('/api/state',{authenticated:false,headers:{Cookie:authCookie}})).status,401);
 const bad=await f.request('/api/login',{method:'POST',body:'password=wrong',authenticated:false});assert.equal(bad.headers.get('set-cookie'),null);
 for(let i=0;i<12;i++)await f.request('/api/login',{method:'POST',body:'password=wrong',authenticated:false});
 assert.equal((await f.request('/api/login',{method:'POST',body:'password=long-test-password',authenticated:false})).headers.get('set-cookie'),null);
});
test('OAuth state is session bound and single use; refresh tokens never reach browser',async()=>{
 const f=await fixture(),start=await f.request('/api/reddit/connect');assert.equal(start.status,303);const authorization=new URL(start.headers.get('location'));assert.equal(authorization.searchParams.get('redirect_uri'),config.origin+'/api/reddit/callback');assert.equal(authorization.searchParams.get('scope'),'identity submit read');
 const callback='/api/reddit/callback?state='+authorization.searchParams.get('state')+'&code=example';
 const second=randomToken();await f.store.addSession(hashToken(second),new Date(Date.now()+600000));
 assert.equal((await f.request(callback,{headers:{Cookie:'tp_session='+second}})).status,400);
 assert.equal((await f.request(callback)).status,303);assert.equal((await f.request(callback)).status,400);
 const account=await f.store.account();assert.equal(f.v.open(account.encryptedRefreshToken),'never-send-this-to-browser');
 const response=await(await f.request('/api/state')).text();assert.ok(!response.includes('never-send-this-to-browser'));assert.ok(!response.includes('encryptedRefreshToken'));
 assert.equal((await f.request('/api/reddit/disconnect',{method:'POST',body:{}})).status,200);assert.equal(await f.store.account(),null);
});
test('immediate publication requires owner confirmation and prevents repeated submission',async()=>{
 const f=await fixture();await f.store.setAccount({name:'owner',encryptedRefreshToken:f.v.seal('refresh')});
 assert.equal((await f.request('/api/posts/publish',{method:'POST',body:{id:'post-1'}})).status,400);
 assert.equal((await f.request('/api/posts/publish',{method:'POST',body:{id:'post-1',confirm:true},authenticated:false})).status,401);
 const response=await f.request('/api/posts/publish',{method:'POST',body:{id:'post-1',confirm:true}});assert.equal((await response.json()).status,'published');assert.equal(f.sent,1);
 assert.equal((await f.request('/api/posts/publish',{method:'POST',body:{id:'post-1',confirm:true}})).status,409);assert.equal(f.sent,1);
});
