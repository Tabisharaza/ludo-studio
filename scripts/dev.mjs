import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {parseDevOptions} from './dev-options.mjs';
let options;
try { options=parseDevOptions(process.argv.slice(2)); }
catch(error) { console.error(`Ludo Studio: ${error.message}`); process.exit(2); }
const {default:worker}=await import('../dist/server/index.js');
mkdirSync('.local',{recursive:true});const db=new DatabaseSync('.local/ludo.sqlite');if(!db.prepare("SELECT name FROM sqlite_master WHERE name='rooms'").get())db.exec(readFileSync('drizzle/0000_rooms.sql','utf8').replaceAll('--> statement-breakpoint',''));
const DB={prepare(sql){let values=[];return{bind(...v){values=v;return this;},async first(){return db.prepare(sql).get(...values)??null;},async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};}}}};
const origin=`http://${options.host}:${options.port}`;
const server=createServer(async(req,res)=>{try{const url=`${origin}${req.url}`,chunks=[];for await(const chunk of req){chunks.push(chunk);if(chunks.reduce((n,c)=>n+c.length,0)>4096){res.writeHead(413);res.end();return;}}const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});const response=await worker.fetch(request,{DB});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('Local server error.');}});
server.once('error',error=>{console.error(`Ludo Studio: cannot listen on ${origin}: ${error.code ?? error.message}`);db.close();process.exitCode=1;});
server.listen(options.port,options.host,()=>console.log(`Ludo Studio: ${origin}`));
