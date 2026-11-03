import test from 'node:test';
import assert from 'node:assert/strict';
import { RedditClient } from '../src/reddit.js';
import { config, post } from './helpers.js';
test('Reddit requests use form encoding, OAuth and exact redirect URI',async()=>{
 const calls=[];const client=new RedditClient(config,async(url,options)=>{calls.push({url,options});return Response.json({access_token:'access',refresh_token:'refresh'});});await client.exchange('code');
 const {url,options}=calls[0];assert.equal(url,'https://www.reddit.com/api/v1/access_token');assert.equal(options.body.get('redirect_uri'),config.origin+'/api/reddit/callback');assert.match(options.headers.Authorization,/^Basic /);assert.equal(options.headers['User-Agent'],config.userAgent);
});
test('known Reddit rate-limit errors are recorded as failures and unknown 5xx responses remain uncertain',async()=>{
 const limited=new RedditClient(config,async()=>Response.json({json:{errors:[['RATELIMIT','Wait before posting',null]]}}));assert.equal((await limited.submit(post(),'access')).rateLimited,true);
 const broken=new RedditClient(config,async()=>Response.json({error:'internal'},{status:500}));await assert.rejects(broken.submit(post(),'access'),/Unconfirmed/);
 const confirmed=new RedditClient(config,async()=>Response.json({json:{errors:[],data:{url:'https://www.reddit.com/r/test/comments/one',name:'t3_one'}}}));assert.equal((await confirmed.submit(post(),'access')).status,'published');
});
