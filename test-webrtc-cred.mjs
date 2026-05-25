import 'dotenv/config';

const key = process.env.TELNYX_API_KEY;
const connId = process.env.TELNYX_WEBRTC_CONNECTION_ID;

console.log('API Key set:', !!key);
console.log('WebRTC Connection ID:', connId);

const res = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ connection_id: connId, name: 'loop-webrtc-test' })
});
const d = await res.json();

if (d.data?.id) {
  console.log('✅ Credential created OK, id:', d.data.id, 'sip_username:', d.data.sip_username);
  // Clean up
  await fetch(`https://api.telnyx.com/v2/telephony_credentials/${d.data.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${key}` }
  });
  console.log('✅ Test credential deleted');
} else {
  console.log('❌ ERROR:', JSON.stringify(d, null, 2));
}
