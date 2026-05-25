(async ()=>{
  try{
    const res = await fetch('http://localhost:3000/dev/create-test-customer',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email: 'local.test@example.com', password: 'Password1', businessName: 'Local Test Bistro' })
    });
    const text = await res.text();
    console.log('STATUS', res.status);
    console.log(text);
  }catch(e){console.error(e)}
})();
