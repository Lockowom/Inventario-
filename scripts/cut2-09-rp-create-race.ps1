param(
  [string]$Container = 'supabase_db_inven3'
)

$ErrorActionPreference = 'Stop'

function Invoke-Db([string]$Sql) {
  & docker exec $Container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc $Sql
}

# The ids are fresh on every execution, so this is a repeatable local-only
# two-connection test and never depends on or modifies user fixtures.
$actor = [guid]::NewGuid().ToString()
$inventory = [guid]::NewGuid().ToString()
$reference = [guid]::NewGuid().ToString()
$request = [guid]::NewGuid().ToString()
$email = "cut2-09-race-$actor@example.test"
$warehouse = '00000000-0000-0000-0000-00000000c202'

Invoke-Db @"
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('$actor','authenticated','authenticated','$email','','{}','{}',now(),now());
insert into public.profiles(user_id,display_name,role,user_type,active)
values ('$actor','CUT2-09 race analyst','ANALISTA','PERMANENT',true);
insert into public.inventories(id,name,status,warehouse_id,created_by,prepared_at,prepared_by,opened_at,opened_by)
values ('$inventory','CUT2-09 release race','ABIERTO','$warehouse','$actor',now(),'$actor',now(),'$actor');
insert into public.inventory_assignments(inventory_id,user_id,assigned_by)
values ('$inventory','$actor','$actor');
insert into public.inventory_sealed_references(id,inventory_id,warehouse_id,reference_type,codigo,normalized_reference_key,state,request_id,physical_quantity,sealed_at,sealed_by)
values ('$reference','$inventory','$warehouse','LEGACY','C09-RACE',public.normalize_reference_key('LEGACY','C09-RACE',null),'SEALED','$( [guid]::NewGuid() )',1,now(),'$actor');
"@ | Out-Null

$previewSql = "begin; select set_config('request.jwt.claim.sub','$actor',true); set local role authenticated; select public.preview_rp_release('$inventory','$warehouse',array['$reference'::uuid])->>'fingerprint'; commit;"
$fingerprint = Invoke-Db $previewSql | Select-Object -Last 1
if ($fingerprint -notmatch '^[a-f0-9]{64}$') { throw "Preview did not return a SHA-256 fingerprint: $fingerprint" }

$createSql = "begin; select set_config('request.jwt.claim.sub','$actor',true); set local role authenticated; select public.create_rp_release('$inventory','$warehouse',array['$reference'::uuid],'$fingerprint','$request'); commit;"

# Start two independent libpq clients together.  The RPC locks the inventory
# row; one creates, the other waits and returns the same idempotent snapshot.
$left = Start-Job -ArgumentList $Container,$createSql -ScriptBlock { param($container,$sql) & docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc $sql }
$right = Start-Job -ArgumentList $Container,$createSql -ScriptBlock { param($container,$sql) & docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atqc $sql }
$null = Wait-Job $left,$right
$leftOutput = Receive-Job $left
$rightOutput = Receive-Job $right
Remove-Job $left,$right

$batches = [int](Invoke-Db "select count(*) from public.rp_release_batches where inventory_id='$inventory' and request_id='$request';")
$audits = [int](Invoke-Db "select count(*) from public.rp_release_audits a join public.rp_release_batches b on b.id=a.release_id where b.inventory_id='$inventory' and b.request_id='$request';")
if ($batches -ne 1 -or $audits -ne 1) { throw "CREATE/CREATE failed: batches=$batches audits=$audits`nleft=$leftOutput`nright=$rightOutput" }

Write-Output "CUT2-09 CREATE/CREATE PASS: one batch and one immutable audit for request $request"
