#!/usr/bin/env node
'use strict';
/* Teste real em Chromium do HTML produzido nesta execução. */
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const port = 8765;
const server = spawn('python',['-m','http.server',String(port),'--bind','127.0.0.1'],
    {stdio:'ignore'});
let browser;
async function waitForServer() {
    for (let attempt=0; attempt<35; attempt++) {
        try {
            const response = await fetch('http://127.0.0.1:'+port+'/');
            if (response.ok) return;
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve,150));
    }
    throw new Error('Servidor local não iniciou');
}
(async ()=>{
    await waitForServer();
    browser = await chromium.launch({headless:true,args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route(/https?:\/\/(www\.youtube\.com|www\.google\.com|i\.ytimg\.com|fonts\.googleapis\.com)\/.*/,route=>route.abort());
    await page.goto('http://127.0.0.1:'+port+'/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(300);
    assert.equal(errors.length,0,'Erros JavaScript na inicialização: '+errors.join(' | '));
    assert.equal(await page.locator('#extra-media').count(),1,'Filtro por tipo ausente');
    assert.equal(await page.locator('#ports-show-more').count(),1,'Carregamento progressivo ausente');
    assert.equal(await page.locator('#source-audit-data').count(),1,'Diagnóstico ausente');
    assert.equal(await page.locator('#ports-relevance').count(),1,'Filtro de relevância ausente');
    const checks=await page.evaluate(()=>{
        const ports=PORTS_VIDEOS.length;
        const id=ports ? PORTS_VIDEOS[0].id : null;
        if (!id) return {empty:true};
        const beforeMain=isWatched(id);
        const beforePorts=portsIsWatched(id);
        const beforeTime=document.getElementById('time-remaining').textContent;
        toggleWatched(id,'ports');
        const afterMain=isWatched(id);
        const afterPorts=portsIsWatched(id);
        const afterTime=document.getElementById('time-remaining').textContent;
        return {empty:false,beforeMain,afterMain,beforePorts,afterPorts,beforeTime,afterTime};
    });
    if (!checks.empty) {
        assert.equal(checks.afterMain,checks.beforeMain,'Portes alterou assistidos do Jornal');
        assert.notEqual(checks.afterPorts,checks.beforePorts,'Portes não mudou seu estado');
        assert.equal(checks.afterTime,checks.beforeTime,'Portes alterou o tempo do Jornal');
    }
    await page.selectOption('#extra-media','shorts');
    const media=await page.evaluate(()=>extra.media);
    assert.equal(media,'shorts','Filtro Shorts não funcionou');
    await page.selectOption('#extra-media','all');
    await page.locator('#ports-relevance').check();
    assert.equal(await page.evaluate(()=>portsRelevantOnly),true,'Filtro de relevância não foi ligado');
    await page.locator('#ports-relevance').uncheck();
    const noNestedScroll=await page.evaluate(()=>{
        const style=getComputedStyle(document.querySelector('.ports-video-list'));
        return style.overflowY !== 'auto' && style.overflowY !== 'scroll';
    });
    assert.equal(noNestedScroll,true,'Painel de portes prendeu o scroll');
    assert.equal(errors.length,0,'Erros JavaScript após interação: '+errors.join(' | '));
    await page.setViewportSize({width:1280,height:720});
    assert.equal(await page.locator('h1').count(),1,'Cabeçalho ausente no desktop');
    console.log('Chromium: interface, filtros, isolamento dos históricos, tempo e rolagem OK');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    if(browser) await browser.close();
    server.kill();
});
