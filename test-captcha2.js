const fetch = require('node-fetch');

async function test() {
  const apiKey = '43fd4b9f30bf5fb87af2b5ab1e6313d8';
  
  // Direct API call to 2captcha
  const params = new URLSearchParams({
    key: apiKey,
    method: 'turnstile',
    sitekey: '0x4AAAAAAADnPIDROrmt1Wwj',
    pageurl: 'https://app.maloum.com/vault',
    action: 'managed',
    json: '1'
  });
  
  console.log('Submitting captcha...');
  const submitUrl = 'https://2captcha.com/in.php?' + params.toString();
  console.log('URL:', submitUrl);
  
  try {
    const res = await fetch(submitUrl);
    const data = await res.json();
    console.log('Submit response:', data);
    
    if (data.status === 1) {
      // Wait for solution
      const taskId = data.request;
      console.log('Task ID:', taskId);
      
      // Poll for result
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const resultRes = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`);
        const result = await resultRes.json();
        console.log('Result:', result);
        
        if (result.status === 1) {
          console.log('Solution:', result.request);
          break;
        } else if (result.request !== 'CAPCHA_NOT_READY') {
          console.log('Error:', result);
          break;
        }
      }
    } else {
      console.log('Submit error:', data);
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test();
