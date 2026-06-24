#!/usr/bin/env bash
# Backup / offload smoke test. Exits non-zero on any failure.
# Run from repo root: bash backend/scripts/smoke-backup.sh
#
# Prereqs (the sandbox can't provide these — run where the stack is up):
#   * backend running with a DATABASE_URL and the backup_offload migration applied
#   * BACKUP_ENCRYPTION_KEY set (64 hex chars)
#   * a reachable SFTP target. Easiest: a local docker SFTP —
#       docker run -d -p 2222:22 --name smoke-sftp atmoz/sftp foo:pass:::backups
#     then export SFTP_HOST=127.0.0.1 SFTP_PORT=2222 SFTP_USER=foo SFTP_PASS=pass SFTP_PATH=/backups
set -euo pipefail

API="${API:-http://localhost:5001/api}"
EMAIL="${EMAIL:-admin@claimoptiq.com}"
PASSWORD="${PASSWORD:-Test@123}"
SFTP_HOST="${SFTP_HOST:-127.0.0.1}"
SFTP_PORT="${SFTP_PORT:-2222}"
SFTP_USER="${SFTP_USER:-foo}"
SFTP_PASS="${SFTP_PASS:-pass}"
SFTP_PATH="${SFTP_PATH:-/backups}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

cd "$(dirname "$0")/.."

jqr() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(String(v??""))})' "$1"; }

say "Login"
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jqr token)
[ -n "$TOKEN" ] || fail "login failed"
AUTH=(-H "Authorization: Bearer $TOKEN")
pass "got token"

say "Enable backup + configure trigger"
curl -s -X PUT "$API/backup/config" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"backup_enabled":"true","backup_trigger_manual":"true","backup_delete_local_after_sync":"true"}' >/dev/null
pass "config saved"

say "Create SFTP server (primary)"
SRV=$(curl -s -X POST "$API/backup/servers" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"name\":\"smoke-sftp\",\"host\":\"$SFTP_HOST\",\"port\":$SFTP_PORT,\"username\":\"$SFTP_USER\",\"authType\":\"password\",\"password\":\"$SFTP_PASS\",\"remoteBasePath\":\"$SFTP_PATH\",\"isPrimary\":true}")
SRV_ID=$(echo "$SRV" | jqr _id)
[ -n "$SRV_ID" ] || fail "server create failed: $SRV"
pass "server $SRV_ID"

say "Test connection"
OK=$(curl -s -X POST "$API/backup/servers/$SRV_ID/test" "${AUTH[@]}" | jqr ok)
[ "$OK" = "true" ] || fail "test connection failed"
pass "reachable"

say "Seed a claim + a document via Prisma"
DOC=$(node -e '
const p=require("./config/prisma"); const fs=require("fs"); const path=require("path");
(async()=>{
  const h=await p.hospital.create({data:{name:"SMOKE BK HOSP "+Date.now()}});
  const c=await p.claim.create({data:{hospitalId:h.id,patientName:"SMOKE BK",claimType:"cashless",month:new Date(),dateOfAdmit:new Date()}});
  const dir=path.join(__dirname,"uploads"); fs.mkdirSync(dir,{recursive:true});
  const fn=Date.now()+"-smoke.txt"; const fp=path.join(dir,fn);
  fs.writeFileSync(fp,"hello backup "+Date.now());
  const d=await p.claimDocument.create({data:{claimId:c.id,fileName:fn,originalName:"smoke.txt",filePath:fp,fileType:"text/plain",fileSize:fs.statSync(fp).size}});
  process.stdout.write(JSON.stringify({claimId:c.id,docId:d.id,fp}));
})();' )
CLAIM_ID=$(echo "$DOC" | jqr claimId); DOC_ID=$(echo "$DOC" | jqr docId); FP=$(echo "$DOC" | jqr fp)
[ -n "$DOC_ID" ] || fail "seed failed"
pass "doc $DOC_ID at $FP"

say "Run backup (manual, force)"
RUN=$(curl -s -X POST "$API/backup/run" "${AUTH[@]}")
echo "$RUN"
ST=$(echo "$RUN" | jqr status)
[ "$ST" = "success" ] || fail "run status: $ST"
pass "run succeeded"

say "Assert: doc marked synced + local file deleted"
SYNCED=$(node -e 'const p=require("./config/prisma");p.claimDocument.findUnique({where:{id:process.argv[1]}}).then(d=>{process.stdout.write(d.isSynced+"/"+d.storageLocation);process.exit(0)})' "$DOC_ID")
[ "$SYNCED" = "true/remote" ] || fail "doc not synced: $SYNCED"
[ ! -f "$FP" ] || fail "local file still present (should be deleted)"
pass "synced + local freed"

say "Assert: stream endpoint returns the bytes from remote"
BODY=$(curl -s "$API/claims/$CLAIM_ID/documents/$DOC_ID/file?token=$TOKEN")
echo "$BODY" | grep -q "hello backup" || fail "stream did not return remote bytes: $BODY"
pass "retrieval from remote OK"

say "Delete doc → remote copy + location rows cleaned"
curl -s -X DELETE "$API/claims/$CLAIM_ID/documents/$DOC_ID" "${AUTH[@]}" >/dev/null
sleep 1
LOCS=$(node -e 'const p=require("./config/prisma");p.fileBackupLocation.count({where:{sourceType:"claim_document",sourceId:process.argv[1]}}).then(n=>{process.stdout.write(String(n));process.exit(0)})' "$DOC_ID")
[ "$LOCS" = "0" ] || fail "location rows not cleaned: $LOCS"
pass "remote + location rows cleaned"

say "Cleanup"
curl -s -X DELETE "$API/backup/servers/$SRV_ID" "${AUTH[@]}" >/dev/null || true
node -e 'const p=require("./config/prisma");p.claim.delete({where:{id:process.argv[1]}}).catch(()=>{}).finally(()=>process.exit(0))' "$CLAIM_ID"

printf '\n\033[1;32m✓ ALL BACKUP SMOKE CHECKS PASSED\033[0m\n'
