import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [n,u,w,h] of [['hub2','/rfo',1320,1100],['hub2-375','/rfo',375,900]]){
  const p = await b.newPage({ viewport:{width:w,height:h} });
  await p.goto('http://localhost:4322'+u,{waitUntil:'networkidle'}).catch(()=>{});
  await p.waitForTimeout(500);
  await p.screenshot({path:`/tmp/acqshots/${n}.png`});
  await p.close(); console.log(n,'ok');
}
await b.close();
