export const meta = {
  name: 'ironclad-basketball-stats-solution',
  description: 'Deep research for a PROVEN, deployed-at-scale basketball stats solution + Databricks build; adversarially verify the "proven" claims; judge-panel the candidate architectures; deliver one recommended solution with a validation protocol',
  phases: [
    { title: 'Research', detail: 'parallel deep sweep prioritizing deployed-at-scale evidence + reproducible pipelines' },
    { title: 'Verify', detail: 'hard adversarial fact-check of every "proven/at-scale/accuracy" claim' },
    { title: 'Design', detail: 'generate 3 candidate iron-clad architectures, score with a judge panel' },
    { title: 'Synthesize', detail: 'draft -> skeptical critic -> final recommended solution + validation protocol' },
  ],
}

const BASELINE = `BASELINE WE HAVE: nvidia/LocateAnything-3B (vision-language grounding model) is LIVE as a GPU Model Serving pyfunc on Databricks (A100, scale-to-zero, MLflow, UC-registered) returning per-frame person boxes (0-1000 normalized) from image+text. We already sampled a copyright-free basketball clip at 1fps and got per-frame person boxes; observed limits: it only LOCATES (no tracking, no identity, no ball, no events), greedy decode degenerates into a repeated trailing box, "person" grounds the whole arena (crowd+sideline not just the 10 players), jersey-color prompts don't reliably separate teams.`

const PRIOR = `PRIOR-ROUND CONCLUSION (the honesty anchor we must beat): a single ARBITRARY moving broadcast camera CANNOT yield a trustworthy per-named-player full box score (true 3D, persistent identity for all 10, and off-ball events are geometrically/informationally out of reach from one view). Official NBA stats use instrumented multi-camera rigs (SportVU->Second Spectrum->Sony Hawk-Eye) and substantial human tagging. SoccerNet Game-State-Reconstruction (single moving cam) is only ~64 GS-HOTA = "half solved" on soccer, and basketball is harder.`

const GOAL = `GOAL FOR THIS ROUND: the user wants an IRON-CLAD, PROVEN solution. "Proven" = there exists real-world evidence it works (deployed at scale with published/validated accuracy, OR a reproducible open-source pipeline with reported numbers), NOT an aspirational design. The intellectual move is to find the combination of (a) CONTROLLED CAPTURE constraints (e.g. one fixed elevated wide camera, known court, manual one-time calibration, roster known) and (b) a BOUNDED STAT SET that PROVEN systems actually ship, such that accuracy becomes defensible. Identify exactly which constraints buy which guarantees, with evidence.`

const RULES = `RESEARCH RULES: Use WebSearch + WebFetch aggressively and deeply (follow citations, read primary sources, vendor validation pages, app-store metrics, papers-with-code, GitHub READMEs with reported metrics). PRIORITIZE EVIDENCE OF REAL DEPLOYMENT: user counts, venue counts, shots-tracked counts, published accuracy vs ground truth, league/partner adoption, reproducible code + numbers. For every system: state the EXACT camera setup it requires (single phone on tripod? fixed elevated? multi-cam rig? wearables?), the EXACT stats it automates vs leaves to humans, and any PUBLISHED accuracy/validation number with its source. Be brutally honest: separate "marketing claim" from "independently validated". Flag where a number is vendor-self-reported vs third-party. Ground EVERY non-obvious claim with a source URL. Your key_claims WILL be adversarially fact-checked.`

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: '5-9 sentence state of proven practice for this dimension' },
    proven_systems_or_methods: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' },
          what_it_is: { type: 'string' },
          camera_setup_required: { type: 'string', description: 'EXACT: single phone/tripod, fixed elevated wide, panoramic, multi-cam rig, wearables, etc.' },
          stats_automated: { type: 'string', description: 'which stats it actually produces automatically' },
          stats_left_to_human: { type: 'string' },
          deployment_evidence: { type: 'string', description: 'users/venues/shots/leagues — the proof of scale' },
          accuracy_evidence: { type: 'string', description: 'published/validated accuracy number + whether vendor-self-reported or third-party' },
          reproducible: { type: 'string', enum: ['open-code+numbers', 'closed-commercial', 'paper-only', 'unverified'] },
          ironclad_relevance: { type: 'string', description: 'how this informs a proven solution we could build/adopt' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'what_it_is', 'camera_setup_required', 'stats_automated', 'deployment_evidence', 'reproducible', 'sources'],
      },
    },
    key_claims: {
      type: 'array', description: 'the 3-5 most load-bearing factual claims (esp. proven-at-scale / accuracy numbers) a decision rests on',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          claim: { type: 'string' },
          source: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          is_accuracy_or_scale_claim: { type: 'boolean' },
        },
        required: ['claim', 'source', 'confidence'],
      },
    },
    ironclad_takeaway: { type: 'string', description: 'what THIS dimension contributes to an iron-clad proven solution: which constraint to adopt, which proven component to reuse, what to avoid' },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['dimension', 'summary', 'proven_systems_or_methods', 'key_claims', 'ironclad_takeaway'],
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    claim: { type: 'string' },
    verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'PARTIAL', 'UNVERIFIABLE'] },
    evidence: { type: 'string', description: 'specific quote/number/source found; for scale/accuracy claims, note vendor-self-reported vs third-party' },
    corrected_claim: { type: 'string', description: 'if REFUTED/PARTIAL, the accurate version; else empty' },
    sources: { type: 'array', items: { type: 'string' } },
  },
  required: ['claim', 'verdict', 'evidence'],
}

const CANDIDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string' },
    one_liner: { type: 'string' },
    capture_constraint: { type: 'string', description: 'exact camera/recording setup this solution mandates' },
    bounded_stat_set: { type: 'string', description: 'precisely which stats it commits to, at what confidence' },
    component_stack: { type: 'string', description: 'ordered named components, each with the proven precedent it borrows' },
    why_ironclad: { type: 'string', description: 'the evidence chain that makes this defensible/proven' },
    databricks_build: { type: 'string' },
    reuses_locateanything: { type: 'string' },
    honest_limits: { type: 'string' },
    effort_estimate: { type: 'string' },
  },
  required: ['name', 'one_liner', 'capture_constraint', 'bounded_stat_set', 'component_stack', 'why_ironclad', 'databricks_build', 'honest_limits'],
}

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    candidate_name: { type: 'string' },
    lens: { type: 'string' },
    score: { type: 'number', description: '0-100 under this lens' },
    strengths: { type: 'string' },
    weaknesses: { type: 'string' },
    is_actually_ironclad: { type: 'boolean', description: 'does the evidence truly support calling this proven/defensible?' },
    best_idea_to_graft: { type: 'string' },
  },
  required: ['candidate_name', 'lens', 'score', 'strengths', 'weaknesses', 'is_actually_ironclad'],
}

const DIMENSIONS = [
  { key: 'consumer_proven', title: 'Proven consumer single-camera basketball AI (HomeCourt/NEX, NEX Team, ShotTracker, Huupe, Spiideo Play)', focus: `Investigate consumer/prosumer single-camera (usually a single phone on a tripod) basketball AI that is DEPLOYED AT SCALE. Especially NEX Team's HomeCourt (Apple-backed, NBA partnership) — how many users/shots tracked, what shot/stat accuracy is published or independently reviewed, exact phone placement, which stats are automatic (made/miss, shot location, shot form, dribble, vertical) vs manual. Also ShotTracker (sensor+camera), Huupe, Spiideo. This is the strongest evidence that BOUNDED single-camera basketball stats are a SOLVED, shipped problem — nail the proof and the exact constraints.` },
  { key: 'venue_proven', title: 'Proven venue/semi-pro single fixed-camera systems (Pixellot AutoStats, Veo Cam, Hudl Focus, Synergy)', focus: `Investigate FIXED single (or panoramic dual-lens) camera venue systems deployed at scale: Pixellot (venue count, AutoStats AI stat product, what stats automated, accuracy), Veo Cam 3 (deployment scale, auto-follow, stats), Hudl Focus (fixed install), Synergy Sports. Exact camera mounting (elevated mid-court fixed/panoramic), what stats are auto vs human-corrected, any published accuracy. These prove the FIXED-ELEVATED-WIDE form factor for team-level + shot stats. Distinguish auto-recording/highlights from actual STAT generation fidelity.` },
  { key: 'goldstd_anchor', title: 'Gold-standard instrumented systems as the proven reference (Second Spectrum/Genius, Sony Hawk-Eye, SportVU, KINEXON)', focus: `Document the proven gold-standard so we know the ceiling and the "buy" option: Second Spectrum/Genius Sports (NBA optical), Sony Hawk-Eye (NBA since 2023-24, camera count, 3D body points), SportVU lineage, KINEXON/ShotTracker wearables (chip-based, NBA G-League/practice). Exact rig (camera count, mounting, calibration), what stats, accuracy/latency. Frame this as the reference output + the buy-if-you-must option, and the hardware gap that makes it non-reproducible from one camera.` },
  { key: 'oss_reproducible', title: 'Reproducible open-source end-to-end basketball pipelines with reported numbers', focus: `Find OPEN-SOURCE, runnable, end-to-end basketball-analytics pipelines that report real numbers (GitHub repos with code + metrics, papers-with-code, Roboflow projects, Kaggle). e.g. roboflow/sports, sportslabkit, abdullahtarek/basketball_analysis, josephattalla shot detection, WASB, AI-basketball-analysis. For each: what it actually outputs end-to-end, on what camera assumption, reported accuracy, how reproducible (stars, maintenance, license, does it run). This is the "build on proven OSS" backbone — be concrete about what's genuinely reproducible vs a demo.` },
  { key: 'detect_track_proven', title: 'Proven detect+track recipe for a fixed-camera basketball scene', focus: `What detector+tracker combination is PROVEN to give stable player tracklets specifically when the camera is FIXED (no pan/zoom/cut) — the controlled-capture case. YOLO11/RT-DETR/YOLOX detector choices + ByteTrack/BoT-SORT/OC-SORT/Deep-EIoU. Reported HOTA/IDF1 on SportsMOT and especially on fixed/steady basketball footage. How much EASIER fixed-camera tracking is (no GMC, no cut fragmentation) and what ID-stability is achievable in practice. Cite numbers and reproducible configs.` },
  { key: 'identity_practical', title: 'Player identity that works in DEPLOYED practice (not just benchmark)', focus: `How do PROVEN/deployed systems actually solve "which player is this" reliably? Cover: closed-set roster + jersey-number OCR coverage in practice, the "5-on-court + logged substitutions" lineup prior, manual one-time roster tagging UIs (tap each player once), team-color clustering (SigLIP/DINOv2+KMeans). What identity accuracy/coverage is actually achieved and HOW deployed systems make it iron-clad (hint: human-assisted enrollment + corrections). This is the hardest pure-CV problem, so document the practical workarounds that make it reliable.` },
  { key: 'ball_shot_proven', title: 'Proven ball/rim detection + made-miss shot detection', focus: `What is PROVEN for ball+rim detection and made/miss classification on basketball video? WASB basketball weights, dedicated shot-detection repos (josephattalla, AI-basketball-analysis), HomeCourt's validated shot detection, Roboflow basketball ball/hoop models. Reported accuracy of made/miss specifically. The geometric made/miss rule (ball passing through rim region) and how reliable it is on a fixed elevated camera vs broadcast. Numbers + reproducibility.` },
  { key: 'calibration_simplified', title: 'Court calibration the iron-clad way (one-time / manual for a fixed camera)', focus: `For a FIXED camera, court registration simplifies enormously: solve the homography ONCE via a manual 4+ point click (court corners/markings) or a one-time keypoint detection, then HOLD it. Document this as the proven, robust path vs per-frame deep calibration (KaliCalib/PnLCalib needed only for moving cameras). What error budget a one-time manual homography gives for shot charts / 2-vs-3 line, and how deployed systems do calibration (Pixellot/Veo install-time calibration). This is a key iron-clad simplification — prove it's robust.` },
  { key: 'made_miss_fusion', title: 'Multi-signal made/miss & event fusion (audio, scoreboard, trajectory)', focus: `Evidence that fusing non-visual signals hardens made/miss and events: audio onset (net swish, rim, whistle, buzzer), scoreboard/clock OCR points-delta, ball trajectory. Any system/paper that fuses these and reports a lift. How depth-/occlusion-/motion-agnostic audio is. This raises made/miss from "candidate" to "reliable" — find concrete precedent and any reported precision/recall improvement.` },
  { key: 'controlled_capture', title: 'Controlled capture as THE enabling constraint — recommended rig & what it proves', focus: `Synthesize the case that CONTROLLING THE CAMERA is what makes the problem iron-clad. What is the recommended single-camera rig (height, position mid-court/elevated, FOV, resolution, fps) that deployed systems mandate, and exactly what each constraint buys (fixed=no GMC/cuts; elevated wide=both baskets + less occlusion; known venue=one-time calibration; controlled=consistent lighting). Compare single fixed vs adding a SECOND camera (does 2 cameras crack identity/3D affordably?). Quantify the feasibility jump from arbitrary broadcast to controlled fixed capture.` },
  { key: 'validation_method', title: 'How proven systems VALIDATE accuracy (so we can prove ours)', focus: `How is basketball-stat accuracy actually MEASURED/validated against ground truth in deployed systems and papers? HomeCourt vs manual counts, Pixellot AutoStats validation, official-stat agreement %, per-stat precision/recall protocols, GS-HOTA. The point: define a VALIDATION PROTOCOL we can run on our own footage to PROVE iron-clad-ness (labeled clips, agreement-with-human metric, per-stat acceptance thresholds, confidence calibration). Find precedent for the methodology.` },
  { key: 'event_stats_bound', title: 'Which event stats are reliably automated anywhere (rebounds/assists/steals/blocks)', focus: `Honest bound: which box-score EVENT stats (rebounds, assists, steals, blocks, turnovers, fouls) are reliably automated by ANY deployed single-camera or even instrumented system vs still human-tagged? What does HomeCourt/Pixellot actually claim for these? Where is the proven line between "auto" and "needs human"? This sets the scope boundary for the iron-clad commitment so we never promise an unproven stat.` },
  { key: 'databricks_native_build', title: 'Databricks-native build of the chosen controlled-capture proven pipeline', focus: `${`Concretely, how to build the controlled-capture proven pipeline natively on Databricks: hosting detector/ball/pose/OCR as Model Serving endpoints; one-time homography stored as config; frame+audio extraction and batch inference via Lakeflow/Spark/Ray (stateless per-frame via ai_query; stateful tracking+event logic as imperative Ray/Pandas-UDF job); tracklet+event+shot store in Lakebase/Delta; MLflow for model+metric lifecycle and the validation harness (HOTA/mAP/stat-agreement as MLflow metrics); Genie + FastAPI/React App for query & a human-correction review queue. Note current Databricks capability caveats to verify (Lakebase preview status, ai_query image payload limits, inference-table image truncation, GPU workload-type/VRAM mapping). Where does the existing LocateAnything endpoint fit (offline auto-labeling with QA gate vs replaced by a fast detector)?`}` },
]

const researchPrompt = (d) => `${BASELINE}\n\n${PRIOR}\n\n${GOAL}\n\n${RULES}\n\nDIMENSION: ${d.title}\n${d.focus}\n\nReturn structured findings. Populate every required field. Aim for 3-6 proven systems/methods with EXACT camera setup, deployment evidence, and accuracy evidence (mark vendor-self-reported vs third-party). Your key_claims (especially scale/accuracy claims) will be independently fact-checked — make them precise and cite the strongest source.`

const verifyPrompt = (c, dimTitle) => `You are a ruthless adversarial fact-checker for an "iron-clad PROVEN basketball stats solution" brief (dimension: "${dimTitle}"). The author is at risk of overstating how "proven" something is. Verify this claim with WebSearch + WebFetch against PRIMARY sources. Be maximally skeptical, especially for scale claims (user/venue/shot counts) and accuracy numbers: confirm the exact figure, and DISTINGUISH vendor-self-reported/marketing from independently validated. If you cannot find independent support, return UNVERIFIABLE. If the figure is inflated, dated, or marketing-only, return PARTIAL/REFUTED with a corrected_claim and source. Quote the specific evidence.\n\nCLAIM: "${c.claim}"\nCITED SOURCE: ${c.source}\nSELF-REPORTED CONFIDENCE: ${c.confidence}${c.is_accuracy_or_scale_claim ? '\n[FLAGGED: this is an accuracy/scale claim — scrutinize the number and its provenance hardest.]' : ''}`

// ---------- Phase 1+2: research each dimension; verify its claims as soon as it lands ----------
phase('Research')
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(researchPrompt(d), { agentType: 'general-purpose', label: `research:${d.key}`, phase: 'Research', schema: FINDINGS_SCHEMA }),
  (findings, d) => {
    if (!findings) return { key: d.key, title: d.title, findings: null, verdicts: [] }
    const claims = (findings.key_claims || []).slice(0, 5)
    return parallel(
      claims.map((c) => () =>
        agent(verifyPrompt(c, d.title), { agentType: 'general-purpose', label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      )
    ).then((vs) => ({ key: d.key, title: d.title, findings, verdicts: vs.filter(Boolean) }))
  }
)

const clean = results.filter(Boolean).filter((r) => r.findings)
const totalClaims = clean.reduce((n, r) => n + r.verdicts.length, 0)
const refuted = clean.flatMap((r) => r.verdicts
  .filter((v) => v.verdict === 'REFUTED' || v.verdict === 'PARTIAL' || v.verdict === 'UNVERIFIABLE')
  .map((v) => ({ dimension: r.title, claim: v.claim, verdict: v.verdict, corrected: v.corrected_claim || '', evidence: v.evidence })))
log(`Research+verify done: ${clean.length}/${DIMENSIONS.length} dims, ${totalClaims} claims checked, ${refuted.length} flagged (REFUTED/PARTIAL/UNVERIFIABLE)`)

const dossier = clean.map((r) => ({
  dimension: r.title,
  summary: r.findings.summary,
  proven: r.findings.proven_systems_or_methods,
  takeaway: r.findings.ironclad_takeaway,
  open_questions: r.findings.open_questions,
  verdicts: r.verdicts.map((v) => ({ claim: v.claim, verdict: v.verdict, corrected: v.corrected_claim || '' })),
}))
const DOSSIER_JSON = JSON.stringify(dossier)
const REFUTED_JSON = JSON.stringify(refuted)

// ---------- Phase 3: generate 3 candidate iron-clad architectures, judge with a panel ----------
phase('Design')
const angles = [
  { key: 'pragmatic', prompt: 'ANGLE: the PRAGMATIC build — one fixed elevated wide camera we control + the narrowest bounded stat set that deployed systems prove is reliable + proven OSS components + human-assisted enrollment/correction. Maximize "provably works", minimize unproven scope.' },
  { key: 'buy-core', prompt: 'ANGLE: BUY/INTEGRATE the proven core — adopt a proven commercial capture+CV layer (or its validated approach) as the front-end and use Databricks for the analytics/serving/query layer and any custom stats on top. Maximize evidence-of-working by standing on an already-deployed system.' },
  { key: 'raise-ceiling', prompt: 'ANGLE: RAISE THE CEILING affordably — a controlled TWO-camera (or phone + fixed) setup to crack the identity/3D problems that one view cannot, while staying far cheaper than an arena rig. Push toward per-player attribution becoming defensible.' },
]
const candidates = (await parallel(angles.map((a) => () =>
  agent(`${BASELINE}\n\n${GOAL}\n\nUsing the verified research dossier below, design ONE concrete iron-clad PROVEN basketball-stats solution from this specific angle.\n\n${a.prompt}\n\nGround every component in a proven precedent from the dossier. Be specific about the capture constraint and the bounded stat set you commit to. Respect the flagged/refuted claims (do not rely on them).\n\nDOSSIER:\n${DOSSIER_JSON}\n\nFLAGGED CLAIMS (do not overstate these):\n${REFUTED_JSON}`,
    { label: `design:${a.key}`, phase: 'Design', schema: CANDIDATE_SCHEMA })
))).filter(Boolean)

const lenses = ['proven-ness/evidence-strength', 'accuracy-ceiling-&-honesty', 'buildability-on-Databricks-with-our-baseline', 'cost-&-operational-burden']
const judgings = (await parallel(
  candidates.flatMap((cand) => lenses.map((lens) => () =>
    agent(`You are a skeptical principal evaluator judging a candidate iron-clad basketball-stats solution under ONE lens: "${lens}". Score 0-100 and decide whether the evidence TRULY supports calling it proven/defensible (is_actually_ironclad). Be hard — "iron-clad" is a high bar.\n\nCANDIDATE:\n${JSON.stringify(cand)}\n\nVERIFIED DOSSIER (the only admissible evidence):\n${DOSSIER_JSON}`,
      { label: `judge:${lens.split('/')[0].slice(0, 10)}`, phase: 'Design', schema: JUDGE_SCHEMA, effort: 'high' })
  ))
)).filter(Boolean)

// aggregate scores
const scoreByCand = {}
for (const j of judgings) {
  if (!scoreByCand[j.candidate_name]) scoreByCand[j.candidate_name] = { total: 0, n: 0, ironclad: 0, judgings: [] }
  const s = scoreByCand[j.candidate_name]
  s.total += (j.score || 0); s.n += 1; s.ironclad += j.is_actually_ironclad ? 1 : 0; s.judgings.push(j)
}
const ranked = Object.entries(scoreByCand)
  .map(([name, s]) => ({ name, avg: s.n ? s.total / s.n : 0, ironcladVotes: s.ironclad, n: s.n }))
  .sort((a, b) => b.avg - a.avg)
log(`Judge panel: ${ranked.map((r) => `${r.name}=${Math.round(r.avg)}(${r.ironcladVotes}/${r.n} ironclad)`).join(' | ')}`)
const RANK_JSON = JSON.stringify(ranked)
const CAND_JSON = JSON.stringify(candidates)
const JUDGE_JSON = JSON.stringify(judgings.map((j) => ({ cand: j.candidate_name, lens: j.lens, score: j.score, ironclad: j.is_actually_ironclad, graft: j.best_idea_to_graft, weak: j.weaknesses })))

// ---------- Phase 4: draft -> critic -> final ----------
phase('Synthesize')
const synthBase = `${BASELINE}\n\n${PRIOR}\n\n${GOAL}\n\nYou are a principal CV engineer + Databricks SA writing the FINAL recommendation. Below: the verified dossier, three candidate architectures, the judge-panel scores, and the flagged claims. The judge panel ranked the candidates; synthesize a SINGLE recommended iron-clad solution built on the winner, grafting the best ideas from the others.\n\nDOSSIER:\n${DOSSIER_JSON}\n\nCANDIDATES:\n${CAND_JSON}\n\nJUDGE PANEL (scores + grafts + weaknesses):\n${JUDGE_JSON}\n\nRANKING:\n${RANK_JSON}\n\nFLAGGED CLAIMS (must not be stated as fact):\n${REFUTED_JSON}`

const briefSpec = `Write a STRATEGIC TECHNICAL BRIEF in markdown titled around "An iron-clad, proven basketball stats solution". Sections:\n1. **The reframe that makes it iron-clad** — state plainly that "proven" requires controlling capture + bounding scope; name the single non-negotiable capture constraint and the exact bounded stat set we COMMIT to (and what we explicitly do NOT promise). Lead with the strongest proof-of-existence (e.g. deployed-at-scale systems that already do this).\n2. **The proof: who already does this and at what scale/accuracy** — the evidence table (system, camera setup, stats automated, deployment scale, validated accuracy, vendor-vs-third-party). This is what makes the claim defensible.\n3. **The recommended solution** — the winning architecture: capture rig spec (height/position/FOV/res/fps), the ordered component stack (each tied to its proven precedent), where LocateAnything-3B fits or is replaced, and the human-assisted enrollment/correction that makes identity reliable.\n4. **Reference architecture on Databricks** — concrete: served endpoints (stateless per-frame CV), one-time homography as stored config, frame+audio extraction & batch inference (Lakeflow/Spark/Ray; stateless via ai_query, stateful tracking+event-logic as imperative Ray/Pandas-UDF job), Lakebase/Delta state, MLflow lifecycle + the eval harness, Genie/App + human-correction queue. Include a data-flow diagram. Note the Databricks capability caveats to verify.\n5. **The validation protocol that PROVES it (the "iron-clad" guarantee)** — concrete, runnable: build a labeled eval set, the per-stat acceptance thresholds (precision/recall/agreement-with-human %), confidence calibration, and the gate each phase must pass before it ships. This section is what turns "we built it" into "we proved it".\n6. **Phased roadmap (Crawl/Walk/Run)** — each phase adds one PROVEN stat category, names the concrete deliverable, and states the validation gate it must pass. Crawl is buildable on the existing endpoint + the controlled clip within days/weeks.\n7. **Build vs buy decision** — when to integrate a proven commercial layer vs build on OSS, with the tradeoff.\n8. **Risks, honest limits, and open questions to resolve on our own footage.**\nBe concrete and evidence-anchored. Every "proven" assertion must trace to the dossier. No hand-waving. Where a stat is NOT reliably automatable by anyone, say so and route it to human-in-the-loop.`

const draft = await agent(`${synthBase}\n\n${briefSpec}`, { label: 'synth:draft', phase: 'Synthesize', effort: 'high' })

const critique = await agent(
  `You are a skeptical principal CV engineer AND a Databricks staff architect reviewing this "iron-clad proven solution" draft. Attack: (a) any "proven/at-scale/accuracy" assertion NOT traceable to the verified dossier or that relies on a flagged claim; (b) places the solution is NOT actually iron-clad (hidden unproven dependency, optimistic accuracy, scope creep beyond what's proven); (c) hand-waving in the architecture or the validation protocol (is the protocol actually runnable and does it actually PROVE the claims?); (d) the capture constraint being weaker than the evidence requires; (e) where identity/event stats are over-promised; (f) wrong/vague Databricks specifics; (g) anything missing from the proof table or roadmap gates; (h) whether the LocateAnything baseline is used honestly. Also flag any genuinely strong, defensible move that is under-sold. Output a concrete, itemized, actionable list.\n\nDRAFT:\n${draft}`,
  { label: 'synth:critic', phase: 'Synthesize', effort: 'max' }
)

const final = await agent(
  `Revise the brief to fully address every critique item. Keep it grounded, concrete, evidence-anchored; cut any claim not traceable to the dossier; make the validation protocol genuinely runnable and sufficient to PROVE the stat claims. Preserve the 8-section structure. Output ONLY the final markdown brief.\n\nCONTEXT:\n${synthBase}\n\nDRAFT:\n${draft}\n\nCRITIQUE TO ADDRESS:\n${critique}`,
  { label: 'synth:final', phase: 'Synthesize', effort: 'max' }
)

return {
  brief: final,
  dimensions: clean.length,
  claimsVerified: totalClaims,
  flaggedClaims: refuted.length,
  ranking: ranked,
}
