/* CLI-Regressionstest für die reine Berechnungslogik in index.html. */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
if (!match) throw new Error('Hauptskript in index.html nicht gefunden.');
const marker = '// ---------- Init ----------';
const cut = match[1].indexOf(marker);
if (cut < 0) throw new Error('Init-Marker nicht gefunden.');

const expose = `
  window.SHK_TEST = {
    computeFor:computeFor, validateFor:validateFor, buildPdf:buildPdf, buildProtocolPdf:buildProtocolPdf,
    setCompany:function(c){ state.company=sanitizeCompany(c); },
    sanitizeImportedVals:sanitizeImportedVals,
    auditDefaults:function(){
      var saved=state.vals, report=[];
      try {
        state.vals={}; normalizeMagState(state.vals);
        TOOLS.forEach(function(t){
          try { var ev=effVals(t.id), check=validateFor(t.id,ev), res=check.ok?computeFor(t.id,ev):null; report.push({id:t.id,ok:check.ok&&!!res,errors:check.errors}); }
          catch(e) { report.push({id:t.id,ok:false,errors:[{message:e.message}]}); }
        });
      } finally { state.vals=saved; }
      return report;
    }
  };
})();`;

const context = {
  window:{}, console, setTimeout, clearTimeout,
  confirm:()=>true, alert:()=>{}, prompt:()=>'',
  Blob:global.Blob, URL:global.URL
};
vm.createContext(context);
vm.runInContext(match[1].slice(0, cut) + expose, context, {filename:'index-inline.js'});
const api = context.window.SHK_TEST;

let passed = 0;
function test(name, fn) {
  try {
    if (!fn()) throw new Error('Erwartung nicht erfüllt');
    passed++;
    console.log('✓', name);
  } catch (error) {
    console.error('✗', name, '-', error.message);
    process.exitCode = 1;
  }
}

test('12 kW / 20 K ergeben 516 l/h',()=>api.computeFor('leistung',{modus:'volumenstrom',leistung:12,dt:20}).main.value==='516');
test('Leistung aus Volumenstrom ergibt 12 kW',()=>api.computeFor('leistung',{modus:'leistung',vstrom:516,veinheit:'l/h',dt:20}).main.value==='12,00');
test('Solar-MAG berücksichtigt Vorlage, β und Dampfvolumen',()=>api.computeFor('mag',{art:'solar',vol:50,flaeche:6,kolltyp:'flach',rohrdampf:0,beta:13,hstat:8,pmin:4,psv:6}).main.value==='80');
test('Trinkwasser-MAG ergibt 25 l',()=>api.computeFor('mag',{art:'trinkwasser',vol:300,tk:10,tw:60,pmin:4,peingang:4,psv:6}).main.value==='25');
test('51 kW erfordern beim hinterlegten Sicherheitsventil DN 20',()=>api.computeFor('sv',{leistung:51,psv:3,hstat:10}).main.value==='DN 20');
test('VDI 2035 setzt über 40 l/kW 0,3 °dH an',()=>api.computeFor('fuellwasser',{gesamtleistung:20,leistung:20,vol:900,erzeugerinhalt:'gross',haerte:1}).subs[0].value.startsWith('0,3 °dH'));
test('Schallplanung 55/35 dB an Wand ergibt 11,2 m',()=>api.computeFor('schall',{lw:55,immission:35,ton:0,aufstellung:3}).main.value==='11,2');
test('DIN-18017-Modus liefert für Bad R-PN 60 m³/h',()=>api.computeFor('lueftung',{modus:'din18017',raum18017:'bad',steuerung:'rpn'}).main.value==='60');
test('DIN-18017-Modus unterscheidet separates WC mit 30 m³/h',()=>api.computeFor('lueftung',{modus:'din18017',raum18017:'wc',steuerung:'rpn'}).main.value==='30');
test('Wasserprüfung rechnet 1,1 × Betriebsdruck',()=>api.computeFor('druckpruef',{verfahren:'wasser',werkstoff:'metall',betriebsdruck:8}).main.value==='8,8');
test('Gas-Belastungsprüfung fordert 1 bar für 10 Minuten',()=>{
  const r=api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'belastung',druckabfall:'nein'});
  return r.main.value==='Bestanden'&&r.subs.some(x=>x.label==='Prüfdruck'&&x.value==='0,1 MPa (1 bar)')&&r.subs.some(x=>x.label==='Prüfdauer'&&x.value==='10 min');
});
test('Gas-Dichtheitsprüfung wechselt bei 100 l auf 30/20 Minuten',()=>{
  const r=api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'dichtheit',gasvol:100,druckabfall:'nein'});
  return r.subs.some(x=>x.label==='Anpassungs-/Stabilisierungszeit'&&x.value==='mindestens 30 min')&&r.subs.some(x=>x.label==='Prüfdauer'&&x.value==='mindestens 20 min');
});
test('Gas-Dichtheitsprüfung wechselt bei 200 l auf 60/30 Minuten',()=>{
  const r=api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'dichtheit',gasvol:200,druckabfall:'nein'});
  return r.subs.some(x=>x.label==='Anpassungs-/Stabilisierungszeit'&&x.value==='mindestens 60 min')&&r.subs.some(x=>x.label==='Prüfdauer'&&x.value==='mindestens 30 min');
});
test('Gas-Mitteldruckprüfung zeigt 3 bar, 3 h und mindestens 2 h',()=>{
  const r=api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'mitteldruck',druckabfall:'nein'});
  return r.subs.some(x=>x.label==='Prüfdruck'&&x.value==='0,3 MPa (3 bar)')&&r.subs.some(x=>x.label.indexOf('Stabilisierung')>=0&&x.value==='ca. 3 h')&&r.subs.some(x=>x.label==='Prüfdauer'&&x.value==='mindestens 2 h');
});
test('Gebrauchsfähigkeit bewertet die Grenzwerte 1 und 5 l/h exakt',()=>{
  function result(leak){return api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'gebrauch',leckrate:leak,maengel:'keine'}).main.value;}
  return result(0.999)==='Unbeschränkte Gebrauchsfähigkeit'&&result(1)==='Verminderte Gebrauchsfähigkeit'&&result(4.999)==='Verminderte Gebrauchsfähigkeit'&&result(5)==='Keine Gebrauchsfähigkeit';
});
test('Gebrauchsfähigkeit dokumentiert eine Messung mit Betriebsdruck',()=>{
  const r=api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'gebrauch',gasbetriebsdruck:23,gebrauchsdruck:'betrieb',leckrate:0.5,maengel:'keine'});
  return r.subs.some(x=>x.label==='Betriebs-/Referenzdruck'&&x.value==='23,0 hPa (23,0 mbar)')&&r.subs.some(x=>x.label==='Mess-/Prüfdruck'&&x.value==='Betriebsdruck · 23,0 hPa (23,0 mbar)');
});
test('50-hPa-Messung verlangt die Rückrechnung auf den Betriebsdruck',()=>{
  const r=api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'gebrauch',gasbetriebsdruck:23,gebrauchsdruck:'50',leckrate:0.5,maengel:'keine'});
  return r.subs.some(x=>x.label==='Mess-/Prüfdruck'&&x.value==='50 hPa (50 mbar)')&&r.subs.some(x=>x.label==='Leckmenge bei Betriebs-/Referenzdruck')&&r.note.includes('auf den Betriebs-/Referenzdruck von 23,0 hPa zurückgerechnet')&&r.note.includes('rohe Leckrate bei 50 hPa darf nicht direkt');
});
test('Gebrauchsfähigkeitszweig weist Betriebsdruck über 100 hPa ab',()=>!api.validateFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'gebrauch',gasbetriebsdruck:101,gebrauchsdruck:'betrieb',leckrate:0.5,maengel:'keine'}).ok);
test('Gasgeruch überschreibt eine kleine Leckmenge als akute Gefahr',()=>api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'gebrauch',leckrate:0.1,maengel:'akut'}).main.value==='Keine Gebrauchsfähigkeit');
test('Druckabfall lässt die Gas-Druckprüfung durchfallen',()=>api.computeFor('druckpruef',{anlage:'gas',gasdruckbereich:'niederdruck',gaspruefung:'dichtheit',gasvol:80,druckabfall:'ja'}).main.value==='Nicht bestanden');
test('R290 löst keine F-Gas-Prüfpflicht aus',()=>api.computeFor('kaeltemittel',{mittel:'r290',menge:2000000}).subs[0].value.startsWith('keine F-Gas'));
test('Pflegeheim und Krankenhaus nutzen verschiedene Koeffizienten',()=>api.computeFor('spitzenvs',{typ:'pflege',summe:2}).main.value!==api.computeFor('spitzenvs',{typ:'kh',summe:2}).main.value);
test('FD 968 wird als August 1999 erkannt',()=>api.computeFor('fdnummer',{modus:'fdzudatum',fd:'968'}).main.value==='August 1999');
test('FD 417 wird nach neuer Codierung als Januar 2014 erkannt',()=>api.computeFor('fdnummer',{modus:'fdzudatum',fd:'FD 417'}).main.value==='Januar 2014');
test('Juli 2024 wird zu FD 475 codiert',()=>api.computeFor('fdnummer',{modus:'datumzufd',jahr:2024,monat:'7'}).main.value==='475');
test('Dezember 2030 wird alphanumerisch zu FD 0AC',()=>api.computeFor('fdnummer',{modus:'datumzufd',jahr:2030,monat:'12'}).main.value==='0AC');
test('Kollisionscode FD 001 zeigt 1960 und 2010',()=>{
  const value=api.computeFor('fdnummer',{modus:'fdzudatum',fd:'001'}).main.value;
  return value.includes('Januar 1960')&&value.includes('Januar 2010');
});
test('FD-Tabellengrenzen 1974–2030 stimmen mit den Referenzwerten überein',()=>[
  [1974,1,'421'],[1980,1,'041'],[1999,8,'968'],[2009,12,'992'],[2013,12,'312'],
  [2014,5,'453'],[2019,12,'960'],[2020,1,'037'],[2029,12,'980'],[2030,10,'0AA']
].every(([jahr,monat,fd])=>api.computeFor('fdnummer',{modus:'datumzufd',jahr,monat:String(monat)}).main.value===fd));
test('Viessmann liest die 8. Ziffer mit gewähltem Jahrzehnt',()=>api.computeFor('fdnummer',{hersteller:'viessmann',code:'7324722 400 119',jahrzehnt:'2000'}).main.value==='2004');
test('Vaillant liest Produktionsjahr und -woche aus Stelle 3–6',()=>api.computeFor('fdnummer',{hersteller:'vaillant',format:'neu',code:'21 04 01 006304 0001 005001 N 7'}).main.value==='KW 01 / 2004');
test('Wolf-Altformat ergibt aus 9116… Baujahr 1996 und KW 11',()=>api.computeFor('fdnummer',{hersteller:'wolf',code:'9116 456547'}).main.value==='KW 11 / 1996');
test('Brötje-Herstellnummer 11050131 ergibt Mai 2011',()=>api.computeFor('fdnummer',{hersteller:'broetje',format:'seit2010',code:'11050131'}).main.value==='Mai 2011');
test('Danfoss-Ventilcode BE3921B ergibt KW 39 / 2021',()=>api.computeFor('fdnummer',{hersteller:'danfoss',format:'ventil',code:'BE3921B'}).main.value==='KW 39 / 2021');
test('Honeywell-Datumscode 7812 ergibt KW 12 / 1978',()=>api.computeFor('fdnummer',{hersteller:'honeywell',format:'yyww',code:'7812'}).main.value==='KW 12 / 1978');
test('Grundfos PC 0213 ergibt KW 13 / 2002',()=>api.computeFor('fdnummer',{hersteller:'grundfos',code:'PC:0213'}).main.value==='KW 13 / 2002');
test('Wilo MFY 2020W53 wird als gültige ISO-Woche erkannt',()=>api.computeFor('fdnummer',{hersteller:'wilo',code:'2020W53'}).main.value==='KW 53 / 2020');
test('Nicht vorhandene ISO-Kalenderwoche wird abgewiesen',()=>!api.validateFor('fdnummer',{hersteller:'wilo',code:'2021W53'}).ok);
test('Alle 19 Modi der sechs Sammelrechner liefern ein Ergebnis',()=>{
  const cases=[
    ['leistung',{modus:'volumenstrom',leistung:12,dt:20}],['leistung',{modus:'leistung',vstrom:516,veinheit:'l/h',dt:20}],['leistung',{modus:'waermetauscher',leistung:30,dt:50}],
    ['heizkoerper',{modus:'umrechnung',typ:'platte',pnorm:1500,vl:55,rl:45,tr:20,n:1.3}],['heizkoerper',{modus:'bauform',bauart:'platte',ptyp:'22',hoehe:600,laenge:1000,tiefe:100}],
    ['gas',{modus:'gas',leistungsart:'nutz',leistung:20,eta:95,region:'hh'}],['gas',{modus:'oelduese',leistung:20,eta:92,druck:10,stufen:'1',teilung:60}],['gas',{modus:'kondensat',brennstoff:'erdgasH',leistung:20,ruecklauf:30}],
    ['aufheiz',{modus:'aufheiz',vol:300,tstart:10,tziel:60,leistung:20}],['aufheiz',{modus:'mischwasser',vsp:300,tsp:60,tkalt:10,tmisch:38}],['aufheiz',{modus:'speicher',gebaeude:'efh',personen:4,wohnungen:6,komfort:'mittel'}],
    ['rohrvol',{modus:'ausstoss',di:13,laenge:10,durchfluss:5}],['rohrvol',{modus:'dimension',vstrom:600,v:0.8}],
    ['cop',{modus:'cop',wptyp:'luftwasser',src:2,sink:35}],['cop',{modus:'jaz',bedarf:15000,jz:3.5,strom:28,vergleich:'gas',brennstoff:12,eta:95}],['cop',{modus:'bivalenz',hl:10,tnorm:-12,hgrenze:15,pwp:8}],['cop',{modus:'puffer',pwp:8,typ:'parallel'}],['cop',{modus:'heizkurve',vlnorm:35,tnorm:-12,traum:20,taussen:0,typ:'fbh',n:1.1}]
  ];
  return cases.every(([id,vals])=>{const check=api.validateFor(id,vals),r=check.ok?api.computeFor(id,vals):null;return check.ok&&r&&r.main&&r.main.value&&r.main.value!=='–';}) && api.auditDefaults().some(x=>x.id==='rohrvol'&&x.ok);
});
test('Alter Rechnerzustand wird in ein Sammelprofil migriert',()=>{
  const x=api.sanitizeImportedVals({leistungaus:{vstrom:600,veinheit:'l/h',dt:10}});
  return x.leistung.modus==='leistung'&&x.leistung.profiles.leistung.vstrom===600;
});
test('Rohrimport wird auf 100 Abschnitte begrenzt',()=>{
  const x=api.sanitizeImportedVals({rohrvol:{sections:Array.from({length:130},()=>({di:16,len:5}))}});
  return x.rohrvol.profiles.volumen.sections.length===100;
});
test('Alle 27 sichtbaren Rechner bestehen mit Standardwerten',()=>{
  const report=api.auditDefaults(), bad=report.filter(x=>!x.ok);
  if (bad.length) throw new Error(bad.map(x=>x.id+': '+(x.errors[0]&&x.errors[0].message)).join(', '));
  return report.length===27;
});
test('Heizungs-MAG: Enddruck bis 5 bar = Ansprechdruck − 0,5 bar',()=>api.computeFor('mag',{art:'heizung',vol:200,tmax:70,hstat:5,pmin:0.8,psv:3}).subs.some(x=>x.label==='Enddruck pₑ'&&x.value==='2,50 bar'));
test('Solar-MAG: Enddruck über 5 bar = 0,9 × Ansprechdruck',()=>api.computeFor('mag',{art:'solar',vol:50,flaeche:6,kolltyp:'flach',rohrdampf:0,beta:13,hstat:8,pmin:4,psv:6}).subs.some(x=>x.label==='Enddruck pₑ'&&x.value==='5,40 bar'));
test('Sicherheitsventil automatisch: 15 m statische Höhe erfordern 3,0 bar',()=>api.computeFor('sv',{leistung:25,psv:'auto',hstat:15}).subs[0].value==='3,0 bar');
test('Trinkwasser-MAG prüft keinen ungenutzten Mindestdruck mehr',()=>api.validateFor('mag',{art:'trinkwasser',vol:300,tk:10,tw:60,pmin:8,peingang:4,psv:6}).ok);
test('MwSt zeigt einen Nachlass als eigene Zeile',()=>api.computeFor('mwst',{netto:1000,mwst:19,aufschlag:-10}).subs[0].value==='− 100,00 €');
const protoGas={typ:'gas_nd',objekt:'Musterweg 1',nd_verschl:'ja',nd_bl_ok:'ja',nd_dt_ok:'ja',nd_vol:120};
test('Protokoll Gas-Niederdruck: vollständige Prüfung ist bestanden',()=>api.computeFor('protokoll',protoGas).main.value==='Bestanden – Anlage dicht');
test('Protokoll Gas-Niederdruck: Druckabfall ergibt „Nicht bestanden“',()=>api.computeFor('protokoll',Object.assign({},protoGas,{nd_dt_ok:'nein'})).main.value==='Nicht bestanden');
test('Protokoll Gas-Niederdruck: zu kurze Prüfdauer bei 120 l wird bemängelt',()=>{
  const r=api.computeFor('protokoll',Object.assign({},protoGas,{nd_dt_t:10}));
  return r.main.value==='Prüfbedingungen nicht erfüllt'&&r.subs.some(x=>x.value==='Prüfdauer unter 20 min');
});
test('Protokoll Gebrauchsfähigkeit: 2 l/h ergeben verminderte Gebrauchsfähigkeit',()=>{
  const v={typ:'gas_gf',objekt:'Musterweg 1',gf_leck:2,gf_ausdruck:'ja'};
  ['r1','r2','r3','r4','r5','r6','r7','a1','a2','a3','a4','a5','a6'].forEach(k=>v['gf_'+k]='ja');
  return api.computeFor('protokoll',v).main.value==='Verminderte Gebrauchsfähigkeit';
});
test('Protokoll Trinkwasser: Prüfdruck unter 1,1 × MDP wird bemängelt',()=>api.computeFor('protokoll',{typ:'tw_wasser',objekt:'x',tw_mdp:10,tw_p:10,tw_pa:10,tw_pe:10,tw_gefuellt:'ja',tw_ausgleich:'ja',tw_sicht:'ja',tw_ok:'ja'}).main.value==='Prüfbedingungen nicht erfüllt');
test('Protokoll lehnt negative Messwerte ab',()=>!api.validateFor('protokoll',{typ:'gas_nd',nd_vol:'-5'}).ok);
test('Protokoll-PDF ist ein gültiges PDF mit Titel',()=>{
  const pdf=api.buildProtocolPdf(protoGas);
  return pdf.startsWith('%PDF-1.4')&&pdf.includes('Belastungs- und Dichtheitspr')&&pdf.trim().endsWith('%%EOF');
});
test('Protokoll-PDF: Fußleiste nur bei Aktivierung, 1 cm hoch, in gewählter Farbe',()=>{
  api.setCompany({firma:'Test GmbH'});
  const ohne=api.buildProtocolPdf(protoGas);
  api.setCompany({firma:'Test GmbH',band:true,bandfarbe:'#b3261e'});
  const mit=api.buildProtocolPdf(protoGas);
  api.setCompany({});
  const bar='0.00 0.00 595.28 28.35 re f';
  return !ohne.includes(bar)&&mit.includes('0.702 0.149 0.118 rg\n'+bar);
});
test('Leeres Formular enthält keine eingegebenen Werte und Ankreuzfelder für das Ergebnis',()=>{
  const pdf=api.buildProtocolPdf(Object.assign({},protoGas,{objekt:'Geheimweg 7',auftraggeber:'Kunde XY'}),true);
  return pdf.startsWith('%PDF-1.4')&&pdf.includes('FORMULAR')&&!pdf.includes('Geheimweg')&&!pdf.includes('Kunde XY')&&pdf.includes('(Nicht bestanden) Tj');
});
test('Modernisierte Oberfläche enthält Schnellnavigation, Arbeitsbereich und reduzierte Bewegung',()=>html.includes('class:\'quick-nav\'')&&html.includes('class:\'tool-workspace\'')&&html.includes('@media (prefers-reduced-motion:reduce)'));

if (!process.exitCode) console.log(`\n${passed} Regressionstests bestanden.`);
