import { describe, expect, it, vi } from "vitest";
import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { HandoffService } from "../src/domain/service";
import { configFrom } from "../src/env";
import { D1Repository } from "../src/store/d1";
import { R2BlobStore } from "../src/store/blobs";
import { createApp } from "../src/app";
import { PDF, alice, ORIGIN, sha256Hex } from "./helpers";

const owner = { subject: "user_alice", scopes: ["handoff"], clientId: "review", token: "" };
const cfg=()=>configFrom(env);
const fresh=()=>new HandoffService(new D1Repository(env.DB), new R2BlobStore(env.BLOBS), cfg());
const input=(ids:string[])=>({title:"Independent attachment audit",brief:"A synthetic brief",attachment_ids:ids,idempotency_key:crypto.randomUUID()});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return{resolve,promise};}

describe("independent attachment safety properties",()=>{
 // The reviewer's two race tests reproduced the defects (R2, R3). After the fix the race outcomes differ,
 // so these two tests assert the fixed behaviour with the same interleavings. The other two are unchanged.
 it("a second writer is refused while the first is storing bytes, and the published original matches its checksum",async()=>{
  const repo=new D1Repository(env.DB),blobs=new R2BlobStore(env.BLOBS);
  const svc=new HandoffService(repo,blobs,cfg());
  const firstReachedPut=gate(),releaseFirst=gate();
  const a=new TextEncoder().encode("%PDF-1.4\nORIGINAL_A\n%%EOF"),b=new TextEncoder().encode("%PDF-1.4\nREPLACED_B\n%%EOF");
  const digestA=await sha256Hex(a);
  const realPut=blobs.put.bind(blobs);
  vi.spyOn(blobs,"put").mockImplementation(async(k,v,m)=>{
   await realPut(k,v,m);
   if(m.sha256===digestA){firstReachedPut.resolve();await releaseFirst.promise;}
  });
  const slot=await svc.createUpload(owner,{filename:"race.pdf"});
  const uploadA=svc.receiveBytes(slot,a,{mime_type:"application/pdf"});
  await firstReachedPut.promise;
  await expect(svc.receiveBytes({...slot},b,{mime_type:"application/pdf"})).rejects.toMatchObject({code:"upload_conflict"});
  releaseFirst.resolve();
  expect((await uploadA).sha256).toBe(digestA);
  const packet=await svc.send(owner,input([slot.id]));
  const after=await svc.readAttachment(owner,packet.packet_id,slot.id);
  expect(after.attachment.sha256).toBe(digestA);
  expect(await sha256Hex(await svc.readBlobBytes(after.attachment))).toBe(digestA);
  // Published bytes are immutable.
  await expect(svc.receiveBytes({...slot},b,{mime_type:"application/pdf"})).rejects.toMatchObject({code:"upload_conflict"});
  expect(await sha256Hex(await svc.readBlobBytes(after.attachment))).toBe(digestA);
 });

 it("cleanup that has claimed a file wins: a concurrent send is refused and writes nothing",async()=>{
  const repo=new D1Repository(env.DB),blobs=new R2BlobStore(env.BLOBS);
  const svc=new HandoffService(repo,blobs,cfg());
  const slot=await svc.createUpload(owner,{filename:"old-unattached.pdf"});
  await svc.receiveBytes(slot,PDF,{mime_type:"application/pdf"});
  await env.DB.prepare("UPDATE attachments SET created_at=? WHERE id=?").bind(new Date(Date.now()-8*86400000).toISOString(),slot.id).run();
  const deleteStarted=gate(),releaseDelete=gate();
  const realDelete=blobs.delete.bind(blobs);
  vi.spyOn(blobs,"delete").mockImplementation(async k=>{
   if(k===slot.blob_key){deleteStarted.resolve();await releaseDelete.promise;}
   await realDelete(k);
  });
  const cleanup=svc.cleanup();await deleteStarted.promise;
  const req=input([slot.id]);
  await expect(svc.send(owner,req)).rejects.toMatchObject({code:"not_found"});
  releaseDelete.resolve();await cleanup;
  expect(await repo.getPacketByIdempotencyKey(owner.subject,req.idempotency_key)).toBeNull();
  expect(await repo.getAttachment(slot.id)).toBeNull();
  expect(await env.BLOBS.head(slot.blob_key)).toBeNull();
 });

 it("a send that links a file after cleanup listed it wins: cleanup keeps the file",async()=>{
  const repo=new D1Repository(env.DB),blobs=new R2BlobStore(env.BLOBS);
  const svc=new HandoffService(repo,blobs,cfg());
  const slot=await svc.createUpload(owner,{filename:"old-unattached.pdf"});
  await svc.receiveBytes(slot,PDF,{mime_type:"application/pdf"});
  await env.DB.prepare("UPDATE attachments SET created_at=? WHERE id=?").bind(new Date(Date.now()-8*86400000).toISOString(),slot.id).run();
  const listed=gate(),releaseClaim=gate();
  const realClaim=repo.claimUnattachedForDeletion.bind(repo);
  vi.spyOn(repo,"claimUnattachedForDeletion").mockImplementation(async(id,before)=>{
   if(id===slot.id){listed.resolve();await releaseClaim.promise;}
   return realClaim(id,before);
  });
  const cleanup=svc.cleanup();await listed.promise;
  const packet=await svc.send(owner,input([slot.id]));
  expect(packet.attachments).toHaveLength(1);
  releaseClaim.resolve();await cleanup;
  expect((await svc.read(owner,packet.packet_id)).attachments).toHaveLength(1);
  expect(await env.BLOBS.head(slot.blob_key)).not.toBeNull();
 });

 it("raw owner original URL obeys packet expiry and revocation",async()=>{
  const svc=fresh();const bearer=await alice();
  const slot=await svc.createUpload(owner,{filename:"lifecycle.pdf"});
  await svc.receiveBytes(slot,PDF,{mime_type:"application/pdf"});
  const packet=await svc.send(owner,input([slot.id]));
  const ticket=await svc.issueTicket("download",owner.subject,slot.id,packet.packet_id);
  await svc.revoke(owner,packet.packet_id);
  await env.DB.prepare("UPDATE packets SET expires_at=? WHERE id=?").bind(new Date(Date.now()-1000).toISOString(),packet.packet_id).run();
  expect((await SELF.fetch(`${ORIGIN}/v1/dl/${ticket.token}`)).status).toBe(410);
  const bypass=await SELF.fetch(`${ORIGIN}/v1/attachments/${slot.id}/original`,{headers:{authorization:`Bearer ${bearer}`}});
  expect(bypass.status).toBe(410);
 });

 it("download failure logs redact bearer download tickets",async()=>{
  const svc=fresh();const slot=await svc.createUpload(owner,{filename:"log.pdf"});
  await svc.receiveBytes(slot,PDF,{mime_type:"application/pdf"});
  const packet=await svc.send(owner,input([slot.id]));
  const ticket=await svc.issueTicket("download",owner.subject,slot.id,packet.packet_id);
  const errorLog=vi.spyOn(console,"error").mockImplementation(()=>{});
  try{
   const ctx=createExecutionContext();
   const res=await createApp().fetch(new Request(`${ORIGIN}/v1/dl/${ticket.token}`),{...env,BLOBS:{get:async()=>{throw new Error("synthetic R2 outage")}} as unknown as R2Bucket},ctx);
   await waitOnExecutionContext(ctx);
   expect(res.status).toBe(500);
   expect(errorLog.mock.calls.flat().map(String).join("\n")).not.toContain(`/v1/dl/${ticket.token}`);
  }finally{errorLog.mockRestore();}
 });
});
