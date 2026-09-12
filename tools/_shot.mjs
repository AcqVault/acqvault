import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [n,u,w,h] of [['nav-hub','/rfo',1320,420],['nav-part','/rfo/part-1',1084,420],['nav-375','/deviations',375,520]]){
  const p = await b.newPage({ viewport:{width:w,height:h} });
  await p.goto('http://localhost:4322'+u,{waitUntil:'networkidle'}).catch(()=>{});
  await p.waitForTimeout(400);
  await p.screenshot({path:`/tmp/acqshots/${n}.png`});
  await p.close(); console.log(n,'ok');
}
await b.close();
