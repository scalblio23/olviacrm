import 'dotenv/config';

const apiKey = process.env.TELNYX_API_KEY;
const webrtcConnId = process.env.TELNYX_WEBRTC_CONNECTION_ID;

console.log('Fetching SIP connection details for:', webrtcConnId);

const res = await fetch(`https://api.telnyx.com/v2/credential_connections/${webrtcConnId}`, {
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
});

const json = await res.json();
console.log('Status:', res.status);

if (json?.errors) {
  console.log('ERRORS:', JSON.stringify(json.errors, null, 2));
} else {
  const d = json?.data;
  console.log('\nConnection name:', d?.connection_name);
  console.log('Active:', d?.active);
  console.log('Outbound voice profile ID:', d?.outbound_voice_profile_id);
  console.log('Inbound:', JSON.stringify(d?.inbound, null, 2));
  console.log('Outbound:', JSON.stringify(d?.outbound, null, 2));
  console.log('\nFull data:', JSON.stringify(d, null, 2));
}
