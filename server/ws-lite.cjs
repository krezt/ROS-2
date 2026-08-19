const { EventEmitter } = require('events');
const crypto = require('crypto');
const OPEN = 1, CLOSING = 2, CLOSED = 3;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(opcode,payload=Buffer.alloc(0)){
  if(!Buffer.isBuffer(payload))payload=Buffer.from(payload);
  const len=payload.length;let header;
  if(len<126){header=Buffer.allocUnsafe(2);header[0]=0x80|opcode;header[1]=len;}
  else if(len<=0xffff){header=Buffer.allocUnsafe(4);header[0]=0x80|opcode;header[1]=126;header.writeUInt16BE(len,2);}
  else{header=Buffer.allocUnsafe(10);header[0]=0x80|opcode;header[1]=127;header.writeBigUInt64BE(BigInt(len),2);}
  return Buffer.concat([header,payload]);
}
class WebSocketPeerLite extends EventEmitter{
  constructor(socket,head=Buffer.alloc(0)){
    super();this.on('error',()=>{});this.socket=socket;this.readyState=OPEN;this._buffer=head?.length?Buffer.from(head):Buffer.alloc(0);this._fragmentOpcode=null;this._fragments=[];this._closedEmitted=false;
    socket.on('data',chunk=>this._onData(chunk));socket.on('close',()=>this._finishClose());socket.on('end',()=>this._finishClose());socket.on('error',err=>this.emit('error',err));if(this._buffer.length)queueMicrotask(()=>this._parse());
  }
  send(data){if(this.readyState===OPEN)this.socket.write(frame(0x1,Buffer.from(String(data))));}
  ping(payload=Buffer.alloc(0)){if(this.readyState===OPEN)this.socket.write(frame(0x9,payload));}
  close(code=1000,reason=''){if(this.readyState!==OPEN)return;this.readyState=CLOSING;const rb=Buffer.from(String(reason));const p=Buffer.allocUnsafe(2+rb.length);p.writeUInt16BE(code,0);rb.copy(p,2);try{this.socket.write(frame(0x8,p));}catch{}setTimeout(()=>{try{this.socket.end();}catch{}},15).unref?.();}
  terminate(){if(this.readyState===CLOSED)return;this.readyState=CLOSED;try{this.socket.destroy();}catch{}this._finishClose();}
  _finishClose(){if(this._closedEmitted)return;this._closedEmitted=true;this.readyState=CLOSED;this.emit('close');}
  _onData(chunk){this._buffer=this._buffer.length?Buffer.concat([this._buffer,chunk]):Buffer.from(chunk);this._parse();}
  _parse(){while(this._buffer.length>=2){
    const b0=this._buffer[0],b1=this._buffer[1],fin=!!(b0&0x80),opcode=b0&0x0f,masked=!!(b1&0x80);let len=b1&0x7f,offset=2;
    if(len===126){if(this._buffer.length<4)return;len=this._buffer.readUInt16BE(2);offset=4;}else if(len===127){if(this._buffer.length<10)return;const big=this._buffer.readBigUInt64BE(2);if(big>BigInt(Number.MAX_SAFE_INTEGER))return this.terminate();len=Number(big);offset=10;}
    let mask=null;if(masked){if(this._buffer.length<offset+4)return;mask=this._buffer.subarray(offset,offset+4);offset+=4;}if(this._buffer.length<offset+len)return;
    let payload=Buffer.from(this._buffer.subarray(offset,offset+len));this._buffer=this._buffer.subarray(offset+len);if(masked)for(let i=0;i<payload.length;i++)payload[i]^=mask[i&3];
    if(opcode===0x8){if(this.readyState===OPEN){this.readyState=CLOSING;try{this.socket.write(frame(0x8,payload));}catch{}}try{this.socket.end();}catch{}continue;}
    if(opcode===0x9){if(this.readyState===OPEN)try{this.socket.write(frame(0xA,payload));}catch{}continue;}
    if(opcode===0xA){this.emit('pong',payload);continue;}
    if(opcode===0x1||opcode===0x2){if(fin)this._emitPayload(opcode,payload);else{this._fragmentOpcode=opcode;this._fragments=[payload];}continue;}
    if(opcode===0x0&&this._fragmentOpcode!==null){this._fragments.push(payload);if(fin){const complete=Buffer.concat(this._fragments),original=this._fragmentOpcode;this._fragmentOpcode=null;this._fragments=[];this._emitPayload(original,complete);}}
  }}
  _emitPayload(opcode,payload){this.emit('message',opcode===0x1?payload.toString('utf8'):payload);}
}
class WebSocketServerLite extends EventEmitter{
  constructor({server,path='/ws'}={}){super();if(!server)throw new Error('HTTP server is required');this.clients=new Set();this.path=path;server.on('upgrade',(req,socket,head)=>{try{
    const pathname=new URL(req.url,'http://localhost').pathname;if(pathname!==path){socket.destroy();return;}const key=req.headers['sec-websocket-key'],version=req.headers['sec-websocket-version'];if(!key||version!=='13'){socket.destroy();return;}
    const accept=crypto.createHash('sha1').update(key+GUID).digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'+`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const peer=new WebSocketPeerLite(socket,head);this.clients.add(peer);peer.once('close',()=>this.clients.delete(peer));this.emit('connection',peer,req);
  }catch{try{socket.destroy();}catch{}}});}
}
module.exports={WebSocketServerLite,WebSocketPeerLite,OPEN,CLOSING,CLOSED};
