import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [n,u] of [['dev2','/deviations'],['chg2','/changes'],['exp2','/what-is-the-rfo'],['part2','/rfo/part-1']]){
  const p = await b.newPage({ viewport:{width:1320,height:1000} });
  await p.goto('http://localhost:4322'+u,{waitUntil:'networkidle'}).catch(()=>{});
  await p.waitForTimeout(500);
  await p.screenshot({path:`/tmp/acqshots/${n}.png`});
  await p.close(); console.log(n,'ok');
}
await b.close();
