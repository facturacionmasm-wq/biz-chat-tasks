import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(async () => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const auth = "Basic " + btoa(`${sid}:${tok}`);
  const list = await fetch("https://content.twilio.com/v1/Content?PageSize=50", { headers: { Authorization: auth } }).then(r => r.json());
  const approvals = await fetch("https://content.twilio.com/v1/ContentAndApprovals?PageSize=50", { headers: { Authorization: auth } }).then(r => r.json());
  return new Response(JSON.stringify({ list, approvals }, null, 2), { headers: { "Content-Type": "application/json" } });
});
