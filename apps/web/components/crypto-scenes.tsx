'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { catchUpProbability, impermanentLoss, lpVsHold, posSelect, submitOrder, powExpectedBlocks, simulateTokenomics, swapXForY, toyBlockHash, toyHash, toyMine, verifyToyChain, type BookOrder, type ToyBlock } from '@atlas/shared';
import type * as ThreeNS from 'three';
import { api } from '@/lib/api';
import { Scene3DFrame, useScene3D, type LabelHandle } from './scene3d';

// Crypto Academy scenes (A–G). Each is a SIMPLIFIED, LABELLED teaching model computed by tested pure
// functions in @atlas/shared (crypto-sims, crypto-analytics, learning-sims). None of them is a live
// blockchain, exchange or price feed. Every 3D scene has an equivalent table, works with the keyboard,
// and jumps to its end state under reduced motion.

const Sim = ({ children }: { children: React.ReactNode }) => <p className="warn" role="note"><strong>Simulation.</strong> {children}</p>;
const fmt = (v: number, d = 2) => v.toLocaleString('en-US', { maximumFractionDigits: d });

// ───────────────────────────── A. Transaction journey ─────────────────────────────

const STEPS = [
  { key: 'create', title: '1. Create and sign', text: 'Alice’s wallet builds a transaction (pay Bob 0.1 coin, fee 0.0002) and signs it with her private key. The key never leaves the wallet; only the signature travels.' },
  { key: 'broadcast', title: '2. Broadcast', text: 'The wallet sends the signed transaction to a few nodes. Each node checks the signature and the balance, then passes it to its peers, so it spreads across the network in seconds.' },
  { key: 'mempool', title: '3. Wait in the mempool', text: 'Valid but unconfirmed transactions wait in each node’s memory pool. Block producers usually pick the ones paying the highest fee per unit of block space first.' },
  { key: 'include', title: '4. Included in a block', text: 'A block producer (a miner in proof of work, a validator in proof of stake) puts the transaction in a new block whose header contains the hash of the previous block.' },
  { key: 'confirm', title: '5. Confirmations', text: 'Each later block built on top adds a confirmation. Rewriting the transaction would mean redoing every block after it, which gets harder with each confirmation (probabilistic finality in proof of work; explicit finality checkpoints in some proof-of-stake chains).' },
  { key: 'ledger', title: '6. What the ledger records', text: 'The public ledger stores addresses, amounts, fees, signatures and timestamps. It does not store names: an address is not an identity, though it can sometimes be linked to one.' },
] as const;

function initialChain(): ToyBlock[] {
  const b0 = toyMine(0, '00000000', ['coinbase → miner 3.125'], 2)!;
  const b1 = toyMine(1, b0.hash, ['carol → dan 1.2', 'erin → frank 0.4'], 2)!;
  const b2 = toyMine(2, b1.hash, ['alice → bob 0.1 (fee 0.0002)'], 2)!;
  const b3 = toyMine(3, b2.hash, ['gina → hal 2.0'], 2)!;
  return [b0, b1, b2, b3];
}

export function TxJourneyScene() {
  const [step, setStep] = useState(0);
  const [chain, setChain] = useState<ToyBlock[]>(() => initialChain());
  const broken = verifyToyChain(chain);
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(step: number, chain: ToyBlock[], broken: number | null) => void>(() => undefined);
  const { state, reset } = useScene3D(host, (api3) => {
    const { THREE, scene } = api3;
    const N = 9;
    const nodes: ThreeNS.Mesh[] = [];
    const nodeGeo = new THREE.SphereGeometry(0.32, 20, 14);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const m = new THREE.Mesh(nodeGeo, new THREE.MeshStandardMaterial({ color: 0x4f6d94 }));
      m.position.set(Math.cos(a) * 4.2 - 3.5, 1.2 + Math.sin(a * 2) * 0.3, Math.sin(a) * 4.2);
      scene.add(m);
      nodes.push(m);
    }
    const links = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3a4d68 });
    for (let i = 0; i < N; i++) for (const j of [(i + 1) % N, (i + 3) % N]) links.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([nodes[i]!.position, nodes[j]!.position]), lineMat));
    scene.add(links);
    api3.label('Network of nodes', new THREE.Vector3(-3.5, 3.4, 0), 'title');
    const tx = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshStandardMaterial({ color: 0xf2c14e, emissive: 0x332200 }));
    scene.add(tx);
    const txLabel = api3.label('signed tx', new THREE.Vector3(), '');
    const blocks: { mesh: ThreeNS.Mesh; label: LabelHandle }[] = [];
    const blockGeo = new THREE.BoxGeometry(1.5, 1, 1.2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(blockGeo, new THREE.MeshStandardMaterial({ color: 0x47b07a, transparent: true }));
      m.position.set(3 + i * 1.9, 0.5, 0);
      scene.add(m);
      blocks.push({ mesh: m, label: api3.label('', new THREE.Vector3(3 + i * 1.9, 1.5, 0)) });
    }
    api3.label('Chain of blocks (each stores the previous block’s hash)', new THREE.Vector3(5.8, 2.6, 0), 'title');
    const pos = new THREE.Vector3(-3.5 + 4.2, 1.2, 0);
    update.current = (s, ch, br) => {
      const target = s === 0 ? nodes[0]!.position.clone().add(new THREE.Vector3(0, 0.8, 0))
        : s === 1 ? nodes[3]!.position.clone().add(new THREE.Vector3(0, 0.8, 0))
          : s === 2 ? new THREE.Vector3(-3.5, 1.6, 0)
            : new THREE.Vector3(3 + 2 * 1.9, 1.15, 0.7);
      nodes.forEach((n, i) => ((n.material as ThreeNS.MeshStandardMaterial).emissive.setHex(s >= 1 && (s > 1 || i % 2 === 0) ? 0x16324f : 0x000000)));
      blocks.forEach((b, i) => {
        const visible = s >= 3 ? i <= 2 + (s >= 4 ? 1 : 0) : i <= 1;
        const mat = b.mesh.material as ThreeNS.MeshStandardMaterial;
        mat.opacity = visible ? 1 : 0.12;
        mat.color.setHex(br !== null && i >= br ? 0xd9776a : i === 2 && s >= 3 ? 0xf2c14e : 0x47b07a);
        b.label.setText(visible ? `#${ch[i]!.height} ${ch[i]!.hash}` : '');
      });
      txLabel.setText(s >= 3 ? 'in block #2' : s === 2 ? 'waiting in mempool' : 'signed tx');
      api3.animate((dt) => {
        pos.lerp(target, Math.min(1, dt * 4));
        tx.position.copy(pos);
        tx.rotation.y += dt * 2;
        txLabel.moveTo(pos.clone().add(new THREE.Vector3(0, 0.6, 0)));
        return pos.distanceTo(target) > 0.02;
      });
    };
    return () => { nodeGeo.dispose(); blockGeo.dispose(); lineMat.dispose(); };
  }, { height: 380, target: [1.5, 1, 0], distance: 17, yaw: -0.1, pitch: 0.45 });
  useEffect(() => { update.current(step, chain, broken); }, [step, chain, broken, state]);

  const tamper = () => setChain((c) => c.map((b, i) => (i === 2 ? { ...b, txs: ['alice → bob 100 (edited)'] } : b)));
  return (
    <div className="lab">
      <Sim>An animated explanation with made-up names, a toy hash and toy difficulty. It is not a live blockchain explorer; see Digital Assets → On-chain for real recent blocks.</Sim>
      <div role="group" aria-label="Steps" className="seg wrapseg">{STEPS.map((s, i) => <button key={s.key} aria-pressed={step === i} className={step === i ? 'on' : ''} onClick={() => setStep(i)}>{s.title}</button>)}</div>
      <p className="explain" aria-live="polite">{STEPS[step]!.text}</p>
      <Scene3DFrame state={state} onReset={reset} title="Transaction journey: a signed transaction spreads across a ring of nodes, waits in the mempool, and is included in a chain of blocks" hint="Drag or use the arrow keys to orbit; Home resets." fallback={
        <div className="wrap"><table><caption>Toy chain (hash = FNV-1a of height, previous hash, transactions and nonce; mined to start with “00”)</caption>
          <thead><tr><th scope="col">Block</th><th scope="col">Previous hash</th><th scope="col" style={{ textAlign: 'left' }}>Transactions</th><th scope="col">Nonce</th><th scope="col">Stored hash</th><th scope="col">Recomputed hash</th></tr></thead>
          <tbody>{chain.map((b, i) => <tr key={b.height} className={broken !== null && i >= broken ? 'dn' : ''}><td>#{b.height}</td><td><code>{b.prev}</code></td><td style={{ textAlign: 'left' }}>{b.txs.join('; ')}</td><td>{b.nonce}</td><td><code>{b.hash}</code></td><td><code>{toyBlockHash(b)}</code></td></tr>)}</tbody></table></div>
      }>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label="3D scene; the chain data is in the table below" />
      </Scene3DFrame>
      <div className="row"><button className="btn s" onClick={tamper} disabled={broken !== null}>Edit the transaction in block #2</button><button className="btn s" onClick={() => setChain(initialChain())}>Restore</button></div>
      <p aria-live="polite">{broken === null ? 'Every block’s stored hash matches its contents, and each block points at the hash of the one before it.' : `Block #${broken} no longer matches its stored hash, and every later block points at a hash that is now wrong. Honest nodes reject the edited chain unless all later blocks are redone (mined again), which is what makes old transactions hard to change.`}</p>
    </div>
  );
}

// ───────────────────────────── B. Tokenomics simulator ─────────────────────────────

export function TokenomicsScene() {
  const [p, setP] = useState({ initial: 400, teamLock: 200, cliff: 12, vest: 24, investorLock: 150, iCliff: 6, iVest: 12, emission: 2, burnPct: 0.2, max: 1000, price: 1 });
  const months = 48;
  const rows = useMemo(() => simulateTokenomics({
    initialCirculating: p.initial * 1e6, tranches: [{ label: 'Team', amount: p.teamLock * 1e6, cliffMonths: p.cliff, vestingMonths: p.vest }, { label: 'Investors', amount: p.investorLock * 1e6, cliffMonths: p.iCliff, vestingMonths: p.iVest }],
    monthlyEmission: p.emission * 1e6, monthlyBurnRate: p.burnPct / 100, maxSupply: p.max * 1e6, price: p.price, months,
  }), [p]);
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(r: typeof rows) => void>(() => undefined);
  const { state, reset } = useScene3D(host, (a) => {
    const { THREE, scene } = a;
    const geo = new THREE.BoxGeometry(0.22, 1, 0.8);
    const circ: ThreeNS.Mesh[] = [];
    const lock: ThreeNS.Mesh[] = [];
    for (let m = 0; m <= months; m++) {
      const c = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4f9bd9 }));
      const l = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc4a052, transparent: true, opacity: 0.55 }));
      c.position.x = l.position.x = (m - months / 2) * 0.26;
      scene.add(c, l);
      circ.push(c);
      lock.push(l);
    }
    a.label('Circulating (blue) and still locked (gold), month 0 to 48', new THREE.Vector3(0, 6.2, 0), 'title');
    const capLabel = a.label('', new THREE.Vector3(-6.8, 5.2, 0), 'scale');
    const end = a.label('', new THREE.Vector3(6.4, 0, 0));
    update.current = (r) => {
      const scale = 5 / (p.max * 1e6);
      capLabel.setText(`full height = maximum supply ${fmt(p.max)}M`);
      r.forEach((row, m) => {
        const hc = Math.max(0.01, row.circulating * scale);
        const hl = Math.max(0.01, row.locked * scale);
        circ[m]!.scale.y = hc;
        circ[m]!.position.y = hc / 2;
        lock[m]!.scale.y = hl;
        lock[m]!.position.y = hc + hl / 2;
      });
      const last = r[r.length - 1]!;
      end.setText(`month 48: ${fmt(last.circulating / 1e6, 0)}M circulating`);
      end.moveTo(new THREE.Vector3(6.6, last.circulating * scale + 0.4, 0));
      a.invalidate();
    };
    return () => geo.dispose();
  }, { height: 340, target: [0, 2.6, 0], distance: 15, yaw: -0.25, pitch: 0.3 });
  useEffect(() => { update.current(rows); }, [rows, state]);
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: Number(e.target.value) });
  const s: [keyof typeof p, string, number, number, number][] = [
    ['initial', 'Circulating at launch (M)', 0, 800, 10], ['teamLock', 'Team tokens locked (M)', 0, 400, 10], ['cliff', 'Team cliff (months)', 0, 36, 1], ['vest', 'Team vesting after cliff (months)', 0, 48, 1],
    ['investorLock', 'Investor tokens locked (M)', 0, 400, 10], ['iCliff', 'Investor cliff (months)', 0, 24, 1], ['iVest', 'Investor vesting (months)', 0, 36, 1],
    ['emission', 'New tokens issued per month (M)', 0, 20, 0.5], ['burnPct', 'Burned per month (% of circulating)', 0, 2, 0.05], ['max', 'Maximum supply (M)', 500, 3000, 50],
  ];
  const at = (m: number) => rows[m]!;
  const total = p.initial + p.teamLock + p.investorLock;
  return (
    <div className="lab">
      <Sim>A fictional token with round numbers. Change the schedule and see how circulating supply, market capitalisation and fully diluted valuation (FDV) move. Price is held constant at ${p.price} only to show the arithmetic.</Sim>
      {total > p.max && <p className="warn">Launch plus locked tokens ({fmt(total)}M) exceed the maximum supply ({fmt(p.max)}M). The model still runs, but a real project could not issue this.</p>}
      <div className="grid2">
        <fieldset className="sliders"><legend>Supply schedule</legend>{s.map(([k, l, min, max, step]) => <label key={k} className="field">{l}: <strong>{p[k]}</strong><input type="range" min={min} max={max} step={step} value={p[k]} onChange={set(k)} /></label>)}</fieldset>
        <div>
          <table><caption>Key months</caption><thead><tr><th scope="col">Month</th><th scope="col">Circulating</th><th scope="col">Locked</th><th scope="col">Market cap</th><th scope="col">FDV</th><th scope="col">Circulating ÷ max</th></tr></thead>
            <tbody>{[0, 6, 12, 24, 36, 48].map((m) => <tr key={m}><td>{m}</td><td>{fmt(at(m).circulating / 1e6, 1)}M</td><td>{fmt(at(m).locked / 1e6, 1)}M</td><td>${fmt(at(m).marketCap / 1e6, 1)}M</td><td>${fmt(at(m).fdv / 1e6, 0)}M</td><td>{(at(m).circulatingShare * 100).toFixed(1)}%</td></tr>)}</tbody></table>
          <p className="explain">Largest one-month increase in circulating supply: <strong>{(Math.max(...rows.map((r) => r.monthlyDilution)) * 100).toFixed(1)}%</strong> (month {rows.reduce((b, r, i) => (r.monthlyDilution > rows[b]!.monthlyDilution ? i : b), 0)}). Unlock months are when supply jumps; FDV stays fixed here because it uses the maximum supply.</p>
        </div>
      </div>
      <Scene3DFrame state={state} onReset={reset} title="Tokenomics: one column per month; blue is circulating supply, gold stacked above it is supply still locked" hint="Drag or use the arrow keys to orbit; Home resets." fallback={null}>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label="3D chart; key months are in the table above" />
      </Scene3DFrame>
    </div>
  );
}

// ───────────────────────────── C. Consensus ─────────────────────────────

export function ConsensusScene() {
  const [mode, setMode] = useState<'pow' | 'pos'>('pow');
  const [shares, setShares] = useState([35, 25, 20, 12, 8]);
  const [q, setQ] = useState(10);
  const [z, setZ] = useState(6);
  const blocks = 1000;
  const expected = powExpectedBlocks(shares, blocks);
  const drawn = posSelect(shares, blocks, 11);
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(values: number[], mode: string) => void>(() => undefined);
  const { state, reset } = useScene3D(host, (a) => {
    const { THREE, scene } = a;
    const geo = new THREE.CylinderGeometry(0.55, 0.55, 1, 28);
    const cols = [0x4f9bd9, 0x47b07a, 0xc4a052, 0xd9776a, 0x8c7ae6];
    const bars = cols.map((c, i) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c }));
      const ang = (i / cols.length) * Math.PI * 2;
      m.position.set(Math.cos(ang) * 3.2, 0, Math.sin(ang) * 3.2);
      scene.add(m);
      return { m, l: a.label('', new THREE.Vector3()) };
    });
    a.label('Producers arranged in a ring; height = blocks produced out of 1,000', new THREE.Vector3(0, 6, 0), 'title');
    const cur = bars.map(() => 0.1);
    update.current = (values) => {
      const max = Math.max(...values, 1);
      a.animate((dt) => {
        let moving = false;
        bars.forEach((b, i) => {
          const target = (values[i]! / max) * 4.5 + 0.05;
          cur[i]! += (target - cur[i]!) * Math.min(1, dt * 6);
          if (Math.abs(target - cur[i]!) > 0.01) moving = true;
          b.m.scale.y = cur[i]!;
          b.m.position.y = cur[i]! / 2;
          b.l.setText(`P${i + 1}: ${fmt(values[i]!, 0)}`);
          b.l.moveTo(new THREE.Vector3(b.m.position.x, cur[i]! + 0.4, b.m.position.z));
        });
        return moving;
      });
    };
    return () => geo.dispose();
  }, { height: 320, target: [0, 2, 0], distance: 13, yaw: -0.3, pitch: 0.45 });
  const values = mode === 'pow' ? expected : drawn;
  useEffect(() => { update.current(values, mode); }, [values, mode, state]);
  return (
    <div className="lab">
      <Sim>Simplified models of how block producers are chosen. Real protocols add many rules (difficulty adjustment, slashing, committees, finality gadgets) that are left out here.</Sim>
      <div role="group" aria-label="Consensus model" className="seg"><button aria-pressed={mode === 'pow'} className={mode === 'pow' ? 'on' : ''} onClick={() => setMode('pow')}>Proof of work (expected blocks)</button><button aria-pressed={mode === 'pos'} className={mode === 'pos' ? 'on' : ''} onClick={() => setMode('pos')}>Proof of stake (seeded random draw)</button></div>
      <fieldset className="sliders"><legend>{mode === 'pow' ? 'Share of hash power' : 'Share of stake'} for producers P1–P5</legend>
        {shares.map((s, i) => <label key={i} className="field">P{i + 1}: <strong>{s}</strong><input type="range" min={0} max={60} value={s} onChange={(e) => setShares(shares.map((x, j) => (j === i ? Number(e.target.value) : x)))} /></label>)}
      </fieldset>
      <p className="explain">{mode === 'pow' ? 'In proof of work each attempt to find a block is like a lottery ticket bought with computing power, so the expected share of blocks equals the share of hash power.' : 'In proof of stake a validator is selected with probability proportional to its stake. The draw below uses a fixed seed so it replays the same way; real protocols use verifiable randomness.'}</p>
      <Scene3DFrame state={state} onReset={reset} title="Consensus: five block producers, column height shows blocks produced out of 1,000" hint="Drag or use the arrow keys to orbit; Home resets." fallback={
        <table><caption>Blocks out of {blocks}</caption><thead><tr><th scope="col">Producer</th><th scope="col">Share</th><th scope="col">PoW expected</th><th scope="col">PoS seeded draw</th></tr></thead>
          <tbody>{shares.map((s, i) => <tr key={i}><td>P{i + 1}</td><td>{s}</td><td>{fmt(expected[i]!, 1)}</td><td>{drawn[i]}</td></tr>)}</tbody></table>
      }>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label="3D scene; values are in the table below" />
      </Scene3DFrame>
      <h4>Why waiting for confirmations helps (proof of work)</h4>
      <div className="row"><label className="field">Attacker hash share q: <strong>{q}%</strong><input type="range" min={1} max={49} value={q} onChange={(e) => setQ(Number(e.target.value))} /></label><label className="field">Confirmations z: <strong>{z}</strong><input type="range" min={0} max={12} value={z} onChange={(e) => setZ(Number(e.target.value))} /></label></div>
      <p aria-live="polite">Probability that an attacker with {q}% of hash power ever catches up from {z} blocks behind: <strong>{(catchUpProbability(q / 100, z) * 100).toFixed(4)}%</strong> (formula from the Bitcoin whitepaper, section 11). With 50% or more it reaches 100%.</p>
    </div>
  );
}

// ───────────────────────────── D. Keys and signatures ─────────────────────────────

// Textbook RSA with tiny primes, chosen so the arithmetic is visible. Real wallets use elliptic-curve
// signatures (ECDSA or Schnorr on secp256k1, Ed25519) with 256-bit keys; this key can be broken by hand.
const TOY_N = 3233; // 61 × 53
const TOY_E = 17;
const TOY_D = 2753;
const modPow = (b: number, e: number, m: number) => {
  let r = 1n;
  let x = BigInt(b) % BigInt(m);
  let k = BigInt(e);
  const M = BigInt(m);
  while (k > 0n) {
    if (k & 1n) r = (r * x) % M;
    x = (x * x) % M;
    k >>= 1n;
  }
  return Number(r);
};
const digest = (msg: string) => parseInt(toyHash(msg), 16) % TOY_N;

export function SigningLab() {
  const [msg, setMsg] = useState('Pay 0.10 to address B-7f3a, fee 0.0002, nonce 41');
  const [signed, setSigned] = useState<{ msg: string; sig: number } | null>(null);
  const [check, setCheck] = useState('');
  const sign = () => {
    const sig = modPow(digest(msg), TOY_D, TOY_N);
    setSigned({ msg, sig });
    setCheck(msg);
  };
  const ok = signed ? modPow(signed.sig, TOY_E, TOY_N) === digest(check) : null;
  return (
    <div className="lab">
      <Sim>Toy keys you could crack by hand, so you can see the arithmetic. Never type a real seed phrase or private key into any website, including this one; ATLAS never asks for them.</Sim>
      <div className="grid2">
        <div>
          <p><strong>Private key</strong> (kept in the wallet): d = {TOY_D}</p>
          <p><strong>Public key</strong> (shared): n = {TOY_N}, e = {TOY_E}</p>
          <p className="mu">An address is derived from the public key (for example by hashing it), so anyone can send to it without learning the private key.</p>
          <label className="field">Transaction message<input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={120} /></label>
          <p>Digest of the message (toy hash mod n): <code>{digest(msg)}</code></p>
          <button className="btn" onClick={sign}>Sign with the private key</button>
          {signed && <p>Signature s = digest<sup>d</sup> mod n = <code>{signed.sig}</code></p>}
        </div>
        <div>
          <p><strong>Anyone can verify</strong> with the public key: is s<sup>e</sup> mod n equal to the digest of the message they received?</p>
          <label className="field">Message as received by a node<input value={check} onChange={(e) => setCheck(e.target.value)} disabled={!signed} /></label>
          {signed && <p aria-live="polite">s<sup>e</sup> mod n = <code>{modPow(signed.sig, TOY_E, TOY_N)}</code>; digest of received message = <code>{digest(check)}</code> → {ok ? <span className="t o">Valid signature</span> : <span className="t r">Invalid: the message was changed or signed with a different key</span>}</p>}
          <p className="mu">Try changing one character of the received message (for example the amount). The signature no longer matches, so nodes reject it. That is how a network knows a transaction came from the key holder and was not altered, without ever seeing the private key.</p>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── E. Liquidity pool ─────────────────────────────

export function AmmPoolScene() {
  const [x0, setX0] = useState(1000);
  const [y0, setY0] = useState(2_000_000);
  const [dx, setDx] = useState(50);
  const [feeBp, setFeeBp] = useState(30);
  const [ratio, setRatio] = useState(2);
  const swap = useMemo(() => swapXForY({ x: x0, y: y0, fee: feeBp / 10_000 }, dx), [x0, y0, dx, feeBp]);
  const lp = lpVsHold(1, y0 / x0, (y0 / x0) * ratio);
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(s: typeof swap) => void>(() => undefined);
  const { state, reset } = useScene3D(host, (a) => {
    const { THREE, scene } = a;
    const pts: ThreeNS.Vector3[] = [];
    const sx = 6 / 2000;
    const sy = 4 / 4_000_000;
    const curveMat = new THREE.LineBasicMaterial({ color: 0x7fb2ec });
    let curve: ThreeNS.Line | null = null;
    const before = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshStandardMaterial({ color: 0x47b07a }));
    const after = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd9776a }));
    scene.add(before, after);
    const lb = a.label('', new THREE.Vector3());
    const la = a.label('', new THREE.Vector3());
    a.label('Pool reserves: token X across, token Y up; every swap stays on x · y = k', new THREE.Vector3(3, 4.9, 0), 'title');
    const axes = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 4.4, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(6.4, 0, 0)]), new THREE.LineBasicMaterial({ color: 0x5f7392 }));
    scene.add(axes);
    update.current = (s) => {
      const k = x0 * y0;
      pts.length = 0;
      for (let x = 200; x <= 2000; x += 20) pts.push(new THREE.Vector3(x * sx, Math.min(4.4, (k / x) * sy), 0));
      if (curve) { scene.remove(curve); curve.geometry.dispose(); }
      curve = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), curveMat);
      scene.add(curve);
      before.position.set(x0 * sx, Math.min(4.4, y0 * sy), 0);
      after.position.set(s.pool.x * sx, Math.min(4.4, s.pool.y * sy), 0);
      lb.setText(`before: ${fmt(x0, 0)} X, ${fmt(y0, 0)} Y`);
      lb.moveTo(before.position.clone().add(new THREE.Vector3(-0.2, 0.45, 0)));
      la.setText(`after: ${fmt(s.pool.x, 1)} X, ${fmt(s.pool.y, 0)} Y`);
      la.moveTo(after.position.clone().add(new THREE.Vector3(0.6, -0.45, 0)));
      a.invalidate();
    };
    return () => { curveMat.dispose(); curve?.geometry.dispose(); };
  }, { height: 320, target: [3, 2, 0], distance: 10, yaw: 0, pitch: 0.12 });
  useEffect(() => { update.current(swap); }, [swap, state]);
  return (
    <div className="lab">
      <Sim>A constant-product pool (x · y = k) with fictional tokens X and Y. Real pools (concentrated liquidity, multiple fee tiers, oracles, MEV) behave differently in many details.</Sim>
      <div className="grid2">
        <fieldset className="sliders"><legend>Pool and swap</legend>
          <label className="field">Reserve of X: <strong>{fmt(x0, 0)}</strong><input type="range" min={200} max={2000} step={50} value={x0} onChange={(e) => setX0(Number(e.target.value))} /></label>
          <label className="field">Reserve of Y: <strong>{fmt(y0, 0)}</strong><input type="range" min={400000} max={4000000} step={100000} value={y0} onChange={(e) => setY0(Number(e.target.value))} /></label>
          <label className="field">Swap X into the pool: <strong>{dx}</strong><input type="range" min={1} max={500} value={dx} onChange={(e) => setDx(Number(e.target.value))} /></label>
          <label className="field">Pool fee: <strong>{(feeBp / 100).toFixed(2)}%</strong><input type="range" min={0} max={100} step={5} value={feeBp} onChange={(e) => setFeeBp(Number(e.target.value))} /></label>
        </fieldset>
        <div aria-live="polite">
          <p>You receive <strong>{fmt(swap.dy, 2)} Y</strong> for {dx} X. Pool price before: {fmt(swap.priceBefore, 2)} Y per X; after: {fmt(swap.priceAfter, 2)}.</p>
          <p>Your average price: {fmt(swap.executionPrice, 2)} Y per X, a price impact of <strong>{(swap.priceImpact * 100).toFixed(2)}%</strong> (fee included). Fee kept in the pool: {fmt(swap.feePaid, 3)} X.</p>
          <p className="mu">Formula: Y out = y · x_in(1 − fee) ÷ (x + x_in(1 − fee)). Bigger trades relative to the pool move the price more.</p>
        </div>
      </div>
      <Scene3DFrame state={state} onReset={reset} title="Liquidity pool: the constant-product curve, with the pool state before (green) and after (red) your swap" hint="Drag or use the arrow keys to orbit; Home resets." fallback={null}>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label="3D curve; the numbers are written above" />
      </Scene3DFrame>
      <h4>Impermanent loss</h4>
      <label className="field">Price of X changes by a factor of <strong>{ratio}×</strong><input type="range" min={0.25} max={5} step={0.25} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} /></label>
      <p aria-live="polite">A liquidity provider who deposited 1 X and {fmt(y0 / x0, 0)} Y would hold {fmt(lp.x1, 4)} X and {fmt(lp.y1, 0)} Y after arbitrage. Value: {fmt(lp.lp, 0)} Y, versus {fmt(lp.hold, 0)} Y for simply holding. Impermanent loss: <strong>{(impermanentLoss(ratio) * 100).toFixed(2)}%</strong> = 2√r ÷ (1 + r) − 1, before fees earned.</p>
    </div>
  );
}

// ───────────────────────────── F. Quantitative research (real data when stored) ─────────────────────────────

interface Analytics { series: { label: string } | null; volatility: { rolling_30d: { t: string; v: number }[] }; drawdown: { series?: { t: string; v: number }[]; max?: number }; regime: { current?: string; reason?: string }; returns: Record<string, { value: number | null }> }

export function QuantScene() {
  const [data, setData] = useState<Analytics | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Analytics>('/v1/crypto/assets/bitcoin/analytics').then(setData).catch(() => setFailed(true));
  }, []);
  const real = !!data?.series && data.volatility.rolling_30d.length > 30;
  const vol = real ? data!.volatility.rolling_30d : [];
  const dd = real ? data!.drawdown.series ?? [] : [];
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(v: { t: string; v: number }[], d: { t: string; v: number }[]) => void>(() => undefined);
  const { state, reset } = useScene3D(host, (a) => {
    const { THREE, scene } = a;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const group = new THREE.Group();
    scene.add(group);
    a.label('Rolling 30-day volatility (front row, blue) and drawdown from peak (back row, red)', new THREE.Vector3(0, 5.4, 0), 'title');
    const lv = a.label('', new THREE.Vector3(-7, 4.6, 1));
    const ld = a.label('', new THREE.Vector3(-7, -0.2, -1.4));
    update.current = (v, d) => {
      group.clear();
      const n = Math.min(120, v.length);
      const step = Math.max(1, Math.floor(v.length / n));
      const vs = v.filter((_, i) => i % step === 0);
      const maxV = Math.max(...vs.map((x) => x.v), 0.01);
      vs.forEach((p, i) => {
        const h = (p.v / maxV) * 4;
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4f9bd9 }));
        m.scale.set(0.09, Math.max(0.01, h), 0.6);
        m.position.set((i - vs.length / 2) * 0.12, h / 2, 1);
        group.add(m);
      });
      const ds = d.filter((_, i) => i % Math.max(1, Math.floor(d.length / n)) === 0);
      ds.forEach((p, i) => {
        const h = Math.abs(p.v) * 4;
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9776a }));
        m.scale.set(0.09, Math.max(0.01, h), 0.6);
        m.position.set((i - ds.length / 2) * 0.12, -h / 2 + 4, -1.4);
        group.add(m);
      });
      lv.setText(`volatility: tallest = ${(maxV * 100).toFixed(0)}% annualised`);
      ld.setText('drawdown: hangs down from 0; full length = −100%');
      a.invalidate();
    };
    return () => geo.dispose();
  }, { height: 340, target: [0, 2.2, 0], distance: 15, yaw: -0.45, pitch: 0.3 });
  useEffect(() => { if (real) update.current(vol, dd); }, [real, vol, dd, state]);
  return (
    <div className="lab">
      {real ? <p className="okbox"><strong>Real data:</strong> {data!.series!.label}, stored by ATLAS. Calculated with the documented formulas (Digital Assets → asset → Analytics).</p>
        : <p className="warn">{failed ? 'Stored Bitcoin history could not be loaded.' : !data ? 'Loading stored Bitcoin history…' : 'Not enough stored Bitcoin history yet to draw this scene.'} The scene appears once ATLAS has imported at least a few months of daily candles; it never substitutes simulated prices.</p>}
      {real && (
        <>
          <p>Current regime: <strong>{data!.regime.current?.replace('_', ', ') ?? `not classified (${data!.regime.reason})`}</strong>. 1-year return: {data!.returns['365d']?.value === null || data!.returns['365d'] === undefined ? '—' : `${(data!.returns['365d']!.value! * 100).toFixed(1)}%`}. Maximum drawdown in stored history: {data!.drawdown.max === undefined ? '—' : `${(data!.drawdown.max * 100).toFixed(1)}%`}.</p>
          <p className="mu">Read across the rows: volatility spikes tend to cluster, and deep drawdowns often coincide with high volatility. That is a description of this history, not a forecast, and correlation between the two is not causation.</p>
        </>
      )}
      <Scene3DFrame state={real ? state : 'unavailable'} onReset={reset} title="Quantitative research: rolling volatility and drawdown of stored Bitcoin history" hint="Drag or use the arrow keys to orbit; Home resets." fallback={real ? <p className="mu">The values are on the asset’s Analytics tab, with a table view.</p> : null}>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label="3D chart of stored analytics" style={real ? undefined : { display: 'none' }} />
      </Scene3DFrame>
      <p className="mu">Backtesting assumptions to keep in mind: no look-ahead (signals use only past prices), costs and slippage, survivorship bias (assets that died are missing), and data snooping (trying many rules until one looks good). Digital Assets → Research has a backtest that states all of these.</p>
    </div>
  );
}

// ───────────────────────────── G. Market mechanics (order book depth) ─────────────────────────────

const BASE_BOOK: BookOrder[] = [
  { id: 1, side: 'buy', price: 99.9, qty: 4 }, { id: 2, side: 'buy', price: 99.8, qty: 7 }, { id: 3, side: 'buy', price: 99.6, qty: 12 }, { id: 4, side: 'buy', price: 99.3, qty: 20 }, { id: 5, side: 'buy', price: 99.0, qty: 30 },
  { id: 6, side: 'sell', price: 100.1, qty: 3 }, { id: 7, side: 'sell', price: 100.2, qty: 6 }, { id: 8, side: 'sell', price: 100.5, qty: 10 }, { id: 9, side: 'sell', price: 100.9, qty: 18 }, { id: 10, side: 'sell', price: 101.5, qty: 35 },
];

export function DepthScene() {
  const [size, setSize] = useState(12);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const result = useMemo(() => submitOrder({ bids: BASE_BOOK.filter((o) => o.side === 'buy'), asks: BASE_BOOK.filter((o) => o.side === 'sell') }, { id: 99, side, price: null, qty: size }), [size, side]);
  const filled = result.trades.reduce((a, t) => a + t.qty, 0);
  const avg = filled ? result.trades.reduce((a, t) => a + t.qty * t.price, 0) / filled : null;
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(book: { bids: BookOrder[]; asks: BookOrder[] }) => void>(() => undefined);
  const { state, reset } = useScene3D(host, (a) => {
    const { THREE, scene } = a;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const group = new THREE.Group();
    scene.add(group);
    a.label('Simulated order book: bids (green) left of the spread, asks (red) right; height = quantity waiting', new THREE.Vector3(0, 5.2, 0), 'title');
    update.current = (book) => {
      group.clear();
      for (const o of [...book.bids, ...book.asks]) {
        const h = o.qty / 8;
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: o.side === 'buy' ? 0x47b07a : 0xd9776a }));
        m.scale.set(0.5, Math.max(0.02, h), 0.8);
        m.position.set((o.price! - 100) * 4, h / 2, 0);
        group.add(m);
      }
      a.invalidate();
    };
    return () => geo.dispose();
  }, { height: 300, target: [0, 1.5, 0], distance: 13, yaw: 0, pitch: 0.35 });
  useEffect(() => { update.current(result.book); }, [result, state]);
  const bestBid = Math.max(...result.book.bids.map((o) => o.price!));
  const bestAsk = Math.min(...result.book.asks.map((o) => o.price!));
  return (
    <div className="lab">
      <Sim>A made-up order book with round numbers. Real crypto order books are venue-specific (each exchange has its own), change many times a second and can be thin away from the best prices.</Sim>
      <div className="row">
        <div role="group" aria-label="Order side" className="seg"><button aria-pressed={side === 'buy'} className={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>Market buy</button><button aria-pressed={side === 'sell'} className={side === 'sell' ? 'on' : ''} onClick={() => setSide('sell')}>Market sell</button></div>
        <label className="field">Order size: <strong>{size}</strong><input type="range" min={1} max={70} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
      </div>
      <p aria-live="polite">Filled {filled} of {size} at an average of <strong>{avg === null ? '—' : avg.toFixed(3)}</strong> across {result.trades.length} price level(s). Before the order: best bid 99.90, best ask 100.10, spread 0.20 (0.20%). After: best bid {Number.isFinite(bestBid) ? bestBid.toFixed(2) : 'none'}, best ask {Number.isFinite(bestAsk) ? bestAsk.toFixed(2) : 'none'}. {filled < size ? 'The book ran out: a market order can only fill against orders that exist.' : ''}</p>
      <Scene3DFrame state={state} onReset={reset} title="Order book depth after your market order" hint="Drag or use the arrow keys to orbit; Home resets." fallback={
        <table><caption>Trades from your order</caption><thead><tr><th scope="col">Price</th><th scope="col">Quantity</th></tr></thead><tbody>{result.trades.map((t, i) => <tr key={i}><td>{t.price.toFixed(2)}</td><td>{t.qty}</td></tr>)}</tbody></table>
      }>
        <div ref={host} className="scene3d-host" tabIndex={0} aria-label="3D depth chart; trades are in the table below" />
      </Scene3DFrame>
      <p className="mu">The same coin can trade at slightly different prices on different venues and in different quote currencies (USD, USDT, INR). An aggregated “reference price” is an average across venues, not a price you can trade at.</p>
    </div>
  );
}
