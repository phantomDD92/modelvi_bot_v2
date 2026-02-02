const { Solver } = require('2captcha-ts');

const solver = new Solver('43fd4b9f30bf5fb87af2b5ab1e6313d8');

async function test() {
  try {
    console.log('Testing 2captcha balance...');
    const balance = await solver.balance();
    console.log('Balance:', balance);
    
    console.log('Testing cloudflareTurnstile...');
    const res = await solver.cloudflareTurnstile({
      pageurl: 'https://app.maloum.com/vault',
      sitekey: '0x4AAAAAAADnPIDROrmt1Wwj',
      action: 'managed'
    });
    console.log('Result:', res);
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test();
