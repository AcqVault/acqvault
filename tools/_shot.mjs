import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1320,height:1050} });
await p.goto('http://localhost:4322/',{waitUntil:'networkidle'}).catch(()=>{});
await p.waitForTimeout(800);
await p.screenshot({path:'/tmp/acqshots/home2.png'});
await p.evaluate(()=>window.scrollTo(0,2400)); await p.waitForTimeout(700);
await p.screenshot({path:'/tmp/acqshots/home3.png'});
await b.close(); console.log('ok');
