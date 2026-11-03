import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { vault, passwordVerifier, randomToken, sessionToken } from '../src/security.js';
import { validateState, publicState } from '../src/validation.js';
import { makePublisher } from '../src/publisher.js';
import { MongoStore } from '../src/store.js';
import { config, memoryStore, post } from './helpers.js';

test('configuration is safe by default and uses the actual Render URL', () => {
 const env={NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://app.onrender.com',MONGODB_URI:'mongodb://example',ADMIN_PASSWORD:'long-password-test',TOKEN_ENCRYPTION_KEY:'x'.repeat(32)};
 assert.equal(readConfig(env).origin,'https://app.onrender.com'); assert.equal(readConfig(env).publishingEnabled,false);
 assert.throws(()=>readConfig({...env,APP_URL:'http://insecure.example'}),/HTTPS/);
 assert.throws(()=>readConfig({...env,ADMIN_PASSWORD:'short'}),/12/);
 assert.doesNotThrow(()=>readConfig({...env,ADMIN_PASSWORD:''},{worker:true}));
});
test('refresh tokens are authenticated ciphertext and passwords are verified',async()=>{
 const v=vault('a'.repeat(32)), encrypted=v.seal('private-refresh-token');
 assert.ok(!encrypted.includes('private-refresh-token')); assert.equal(v.open(encrypted),'private-refresh-token');
 assert.throws(()=>vault('b'.repeat(32)).open(encrypted));
 const verify=await passwordVerifier('correct password'); assert.equal(await verify('correct password'),true);assert.equal(await verify('wrong'),false);
 assert.equal(sessionToken({headers:{cookie:'tp_session='+randomToken()}}).length,64);
});
test('input rejects malformed plans, duplicate IDs and executable links',()=>{
 const input={revision:0,posts:[post()],communities:['SideProject']};assert.equal(validateState(input).posts.length,1);
 assert.throws(()=>validateState({...input,posts:[post(),post()]}),/duplicate/);
 assert.throws(()=>validateState({...input,posts:[post('a',{type:'link',url:'javascript:alert(1)'})]}),/link/);
 assert.throws(()=>validateState({...input,posts:[post('a',{at:'invalid'})]}),/date/);
 assert.throws(()=>validateState({...input,communities:["x');alert(1)"]}),/subreddit/);
 assert.equal(validateState({...input,posts:[{...post(),status:'draft'}]}).posts[0].approved,false);
});
function fixture(posts=[post()],overrides={}) {
 const store=memoryStore(posts), v=vault(config.encryptionKey);let sends=0;
 const reddit={refresh:async()=>({access_token:'temporary'}),read:async()=>({data:{is_flair_required:false}}),submit:async()=>{sends++;return {status:'published',url:'https://www.reddit.com/r/SideProject/comments/test',name:'t3_test'};},...overrides};
 const publisher=makePublisher({store,config,reddit,vault:v});return {store,publisher,v,reddit,get sends(){return sends;}};
}
async function connect(f){await f.store.setAccount({name:'test',encryptedRefreshToken:f.v.seal('refresh')});}
test('concurrent scheduler checks submit once and preserve the receipt',async()=>{
 const f=fixture();await connect(f);await Promise.all([f.publisher.due(),f.publisher.due()]);assert.equal(f.sends,1);
 const state=await f.store.getWorkspace();assert.equal(state.posts[0].delivery.status,'published');assert.equal(publicState(state).deliveries['post-1'].name,'t3_test');
 await f.publisher.due();assert.equal(f.sends,1);
});
test('unapproved, future, draft and paused posts do not publish',async()=>{
 const f=fixture([post('no',{approved:false}),post('future',{at:new Date(Date.now()+600000).toISOString()}),post('draft',{status:'draft'})]);await connect(f);await f.publisher.due();assert.equal(f.sends,0);
 const next=await f.store.getWorkspace();next.posts=[post()];next.paused=true;await f.store.saveWorkspace(next);await f.publisher.due();assert.equal(f.sends,0);
});
test('missing credentials and disabled publishing never claim a post',async()=>{
 const f=fixture();const dry=await f.publisher.due({dryRun:true});assert.equal(dry.eligible,1);assert.equal(dry.accountConnected,false);
 const blocked=await f.publisher.due();assert.equal(blocked.results[0].status,'blocked');assert.equal((await f.store.getWorkspace()).posts[0].delivery,undefined);
 const disabled=makePublisher({store:f.store,config:{...config,publishingEnabled:false},reddit:f.reddit,vault:f.v});assert.equal((await disabled.due()).disabled,true);assert.equal(f.sends,0);
});
test('uncertain submissions and missing required flair are held without retry',async()=>{
 const f=fixture(undefined,{submit:async()=>{throw Error('timeout');}});await connect(f);await f.publisher.due();assert.equal((await f.store.getWorkspace()).posts[0].delivery.status,'unknown');assert.equal((await f.publisher.due()).checked,0);
 const g=fixture(undefined,{read:async()=>({data:{is_flair_required:true}})});await connect(g);await g.publisher.due();assert.equal(g.sends,0);assert.equal((await g.store.getWorkspace()).posts[0].delivery.status,'failed');
});
test('attempted posts are immutable and stale edits are rejected',async()=>{
 const f=fixture();await connect(f);const stale=await f.store.getWorkspace();await f.publisher.due();await assert.rejects(f.store.saveWorkspace(stale),/changed/);
 const next=await f.store.getWorkspace();delete next.posts[0].delivery;next.posts[0].title='new content';await assert.rejects(f.store.saveWorkspace(validateState(next)),/cannot be edited/);
});
test('MongoDB claims approval and pause atomically rather than relying on a previous read',async()=>{
 let query,update;const store=new MongoStore({collection:()=>({findOneAndUpdate:async(q,u)=>{query=q;update=u;return {posts:[{id:'post-1',delivery:{status:'sending'}}]};}})});
 const result=await store.claim('post-1');assert.equal(query.paused,false);assert.equal(query.posts.$elemMatch.approved,true);assert.deepEqual(query.posts.$elemMatch.delivery,{$exists:false});assert.equal(update.$set['posts.$.delivery'].status,'sending');assert.equal(result.id,'post-1');
});
