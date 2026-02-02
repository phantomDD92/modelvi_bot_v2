const fetch = require('node-fetch');

async function test() {
  const apiKey = '43fd4b9f30bf5fb87af2b5ab1e6313d8';
  
  // Direct API call without action parameter
  const params = new URLSearchParams({
    key: apiKey,
    method: 'turnstile',
    sitekey: '0x4AAAAAAADnPIDROrmt1Wwj',
    pageurl: 'https://app.maloum.com/vault',
    json: '1'
  });
  
  console.log('Submitting captcha without action...');
  
  try {
    const res = await fetch('https://2captcha.com/in.php?' + params.toString());
    const data = await res.json();
    console.log('Submit response:', data);
    
    if (data.status === 1) {
      const taskId = data.request;
      console.log('Task ID:', taskId);
      
      // Poll for result
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const resultRes = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`);
        const result = await resultRes.json();
        console.log('Poll ' + (i+1) + ':', result.status === 1 ? 'SOLVED' : result.request);
        
        if (result.status === 1) {
          console.log('Solution:', result.request.substring(0, 50) + '...');
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
