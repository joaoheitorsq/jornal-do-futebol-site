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

    // O botão deve recolher controles sem apagar preferências ou afetar
    // o Jornal, e a escolha precisa persistir após recarregar a página.
    const personalizationToggle = page.locator('#extra-collapse-toggle');
    const personalizationContent = page.locator('#extra-tools-content');
    assert.equal(await personalizationToggle.getAttribute('aria-expanded'), 'true',
        'Personalização deve iniciar expandida para visitantes sem preferência');
    await personalizationToggle.click();
    assert.equal(await personalizationToggle.getAttribute('aria-expanded'), 'false',
        'Botão não atualizou aria-expanded ao recolher');
    assert.equal(await personalizationContent.isVisible(), false,
        'Controles não foram ocultados ao recolher');
    assert.equal(await page.evaluate(() => localStorage.getItem(
        'jornal_do_futebol_personalization_collapsed_v1')), '1',
        'Preferência de recolhimento não foi salva');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForTimeout(150);
    assert.equal(await personalizationToggle.getAttribute('aria-expanded'), 'false',
        'Painel não preservou recolhimento após atualizar a página');
    assert.equal(await personalizationContent.isVisible(), false,
        'Conteúdo do painel deveria permanecer oculto após recarregar');
    await personalizationToggle.click();
    assert.equal(await personalizationToggle.getAttribute('aria-expanded'), 'true',
        'Painel não expandiu novamente');
    assert.equal(await personalizationContent.isVisible(), true,
        'Filtros não voltaram a aparecer após expandir');
    assert.equal(await page.locator('#ports-show-more').count(),1,'Carregamento progressivo ausente');
    assert.equal(await page.locator('#source-audit-data').count(),1,'Diagnóstico ausente');
    assert.equal(await page.locator('#ports-relevance').count(),1,'Filtro de relevância ausente');
    // Reproduzir cliques de verdade: o bug anterior passava porque
    // os testes chamavam toggleWatched(id, 'ports') diretamente.
    const portsCount = await page.evaluate(() => PORTS_VIDEOS.length);
    if (portsCount) {
        const card = page.locator('.ports-video-item[data-video-id]').first();
        const button = card.locator('.ports-watch-action');
        const stateBefore = await page.evaluate(() => {
            const id = document.querySelector('.ports-video-item[data-video-id]').dataset.videoId;
            return {
                id, journal: isWatched(id), ports: portsIsWatched(id),
                remaining: document.querySelector('#time-remaining').textContent,
                progress: document.querySelector('#ports-progress').textContent
            };
        });
        await button.click();
        const stateAfter = await page.evaluate(id => ({
            journal: isWatched(id), ports: portsIsWatched(id),
            remaining: document.querySelector('#time-remaining').textContent,
            progress: document.querySelector('#ports-progress').textContent
        }), stateBefore.id);
        assert.equal(stateAfter.journal, stateBefore.journal,
            'Clique real em portes alterou o histórico principal');
        assert.notEqual(stateAfter.ports, stateBefore.ports,
            'Clique real não mudou o assistido de portes');
        assert.equal(stateAfter.remaining, stateBefore.remaining,
            'Clique real de portes modificou o tempo do Jornal');
        assert.notEqual(stateAfter.progress, stateBefore.progress,
            'Progresso de portes não reagiu ao clique');
        assert.equal(await button.getAttribute('aria-pressed'),
            stateAfter.ports ? 'true' : 'false',
            'Botão de portes mostrou estado errado');
        await page.locator('#undo-toast-button').click();
        assert.equal(await page.evaluate(id => portsIsWatched(id), stateBefore.id),
            stateBefore.ports, 'Desfazer não restaurou estado de portes');
        assert.equal(await page.evaluate(id => isWatched(id), stateBefore.id),
            stateBefore.journal, 'Desfazer alterou o Jornal principal');
    }

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
    assert.equal(await page.locator('#ports-clear-filters').isVisible(),true,
        'O filtro de relevância ativo precisa oferecer Limpar filtros');
    await page.locator('#ports-clear-filters').click();
    assert.equal(await page.locator('#ports-relevance').isChecked(),false,
        'Limpar filtros deixou relevância marcada');
    assert.equal(await page.evaluate(() => portsRelevantOnly),false,
        'Limpar filtros não restaurou o catálogo de portes');

    const firstChip = page.locator('.ports-channel-chip[data-channel-handle]').nth(1);
    await firstChip.click();
    assert.equal(await firstChip.getAttribute('aria-pressed'),'true',
        'Chip de canal não dá feedback de seleção');
    await page.locator('#ports-clear-filters').click();
    assert.equal(await firstChip.getAttribute('aria-pressed'),'false',
        'Chip continuou marcado depois de limpar filtros');

    await page.selectOption('#ports-sort','oldest');
    assert.equal(await page.evaluate(() => portsSort),'oldest',
        'Ordenação de portes não respondeu ao controle');
    await page.locator('#ports-clear-filters').click();
    assert.equal(await page.evaluate(() => portsSort),'newest',
        'Limpar filtros não restaurou a ordenação');

    await page.locator('#ports-unwatched-toggle').click();
    assert.equal(await page.locator('#ports-unwatched-toggle').getAttribute('aria-pressed'),
        'true','Só não assistidos não mostrou estado ativo');
    await page.locator('#ports-clear-filters').click();
    assert.equal(await page.locator('#ports-unwatched-toggle').getAttribute('aria-pressed'),
        'false','Limpar filtros não desligou Só não assistidos');

    if (portsCount) {
        await page.locator('#ports-search').fill('_________busca_impossivel_999');
        assert.equal(await page.locator('#ports-filter-empty').isVisible(), true,
            'Busca sem resultados não mostrou feedback');
        await page.locator('#ports-clear-filters').click();
        assert.equal(await page.locator('#ports-search').inputValue(),'',
            'Limpar filtros não apagou a busca');
    }

    if (portsCount > 18) {
        const visibleCount = () => page.locator(
            '.ports-video-item:not([hidden]):not(.ports-limited)').count();
        const initial = await visibleCount();
        assert.equal(initial,18, 'Carregamento progressivo não começou em 18 vídeos');
        await page.locator('#ports-show-more').click();
        assert.ok(await visibleCount() > initial,'Mostrar mais não exibiu novos vídeos');
        const countLabel = await page.locator('#ports-visible-count').textContent();
        assert.ok(countLabel.includes(String(await visibleCount())),
            'Contador não reflete a quantidade realmente na tela');
    }

    if (portsCount > 18) {
        const jump = await page.evaluate(() => {
            resetPortsFilters();
            extra.portsLimit = 18;
            applyPortsLimit();
            setPortsPlaybackMode(true);
            const id = PORTS_VIDEOS[0].id;
            resumeState = {videoId:id, seconds:40, embeddable:true};
            const card = Array.from(document.querySelectorAll('.ports-video-item'))
                .find(item => item.dataset.videoId === id);
            const hiddenBefore = card && card.classList.contains('ports-limited');
            goToResume();
            return {hiddenBefore, hiddenAfter:card?.classList.contains('ports-limited')};
        });
        assert.equal(jump.hiddenBefore, true,
            'Pré-condição: a retomada escolhida precisa estar além dos 18 iniciais');
        assert.equal(jump.hiddenAfter, false,
            'Ir para onde parei não revelou vídeo oculto por carregamento progressivo');
        await page.evaluate(() => setPortsPlaybackMode(false));
    }

    await page.locator('.ports-collapse-toggle').click();
    await page.waitForTimeout(240);
    assert.equal(await page.locator('.ports-extra-controls').isVisible(),false,
        'Controles de relevância ficaram visíveis com o painel recolhido');
    assert.equal(await page.locator('.ports-more-row').isVisible(),false,
        'Mostrar mais ficou visível com o painel recolhido');
    await page.locator('.ports-collapse-toggle').click();
    await page.waitForTimeout(240);
    assert.equal(await page.locator('.ports-extra-controls').isVisible(),true,
        'Controles de relevância não retornaram ao expandir');

    if (portsCount) {
        await page.locator('#ports-play-selection').click();
        const pending = await page.evaluate(() => ({
            mode: portsPlaybackActive,
            id: pendingPlaybackRequest?.id || '',
            text: document.querySelector('#status').textContent
        }));
        assert.equal(pending.mode,true,'Assistir seleção não ativou o modo de portes');
        assert.ok(pending.id,'Player ainda não carregado perdeu o pedido de reprodução');
        assert.match(pending.text,/Preparando o player/,
            'Botão de reprodução exibiu feedback incorreto enquanto a API carregava');
    }
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
