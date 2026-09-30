import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const server=http.createServer((req,res)=>{let file;try{file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)&&file!==root)throw Error();if(file===root||fs.statSync(file).isDirectory())file=path.join(file,'index.html');const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[ext]||'application/octet-stream');res.setHeader('Cache-Control','no-store');fs.createReadStream(file).on('error',()=>{res.statusCode=404;res.end()}).pipe(res)}catch{res.statusCode=404;res.end('Not found')}});
server.listen(4173,'127.0.0.1',()=>console.log('Jelly Room: http://127.0.0.1:4173'));
