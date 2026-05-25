import 'dotenv/config';

const apiKey = process.env.TELNYX_API_KEY;
const connId = process.env.TELNYX_WEBRTC_CONNECTION_ID;
const callConnId = process.env.TELNYX_CONNECTION_ID;

console.log('API Key present:', !!apiKey);
console.log('WebRTC Conn ID:', connId);
console.log('Call Control Conn ID:', callConnId);

// Step 1: Create credential
const credRes = await fetch('https://api.telnyx.com/v2/telephony_credentials', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({ connection_id: connId, name: `test-${Date.now()}` })
});
const credJson = await credRes.json();
console.log('\nCredential creation status:', credRes.status);

if (credJson?.errors) {
  console.log('ERRORS:', JSON.stringify(credJson.errors, null, 2));
  process.exit(1);
}

const credId = credJson?.data?.id;
const credSipUser = credJson?.data?.sip_username;
console.log('Credential ID:', credId);
console.log('SIP Username:', credSipUser);
console.log('Full data:', JSON.stringify(credJson?.data, null, 2));

// Step 2: Get token
const tokRes = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credId}/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
});
const tokText = await tokRes.text();
console.log('\nToken status:', tokRes.status);
console.log('Token (first 100 chars):', tokText.substring(0, 100));

// Step 3: Check what the token decodes to (base64 middle part)
try {
  const parts = tokText.replace(/"/g, '').trim().split('.');
  if (parts.length === 3) {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    console.log('\nToken payload:', JSON.stringify(payload, null, 2));
  }
} catch (e) {
  console.log('Could not decode token');
}

// Cleanup
await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credId}`, {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
console.log('\nCredential cleaned up');
