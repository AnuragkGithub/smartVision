import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const navigation = [
  { id: "overview", label: "Overview", icon: "◫" },
  { id: "inspect", label: "Inspection studio", icon: "⌕" },
  { id: "shortlist", label: "Review shortlist", icon: "◉" },
  { id: "records", label: "Inspection records", icon: "▤" },
  { id: "guide", label: "How it works", icon: "ⓘ" },
];

const categories = ["Metal component", "Textile", "Packaging", "Other"];

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function Icon({ name }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    moon: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    back: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function useObjectUrl(file) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

function App() {
  const [page, setPage] = useState("overview");
  const [theme, setTheme] = useState(() => {
    try {
      return window.localStorage.getItem("smartvision-theme") || "light";
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError") return "light";
      throw error;
    }
  });
  const [category, setCategory] = useState(categories[0]);
  const [operator, setOperator] = useState("");
  const [result, setResult] = useState(null);
  const [records, setRecords] = useState([]);
  const [shortlist, setShortlist] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({ batch: "All batches", decision: "All outcomes" });
  const [reviewer, setReviewer] = useState("");
  const [approved, setApproved] = useState(false);
  const [form, setForm] = useState({ batchId: "", partId: "", notes: "" });
  const [files, setFiles] = useState({ reference: null, candidate: null });
  const [settings, setSettings] = useState({ threshold: 22, minArea: 35, reviewThreshold: 30 });
  const referenceInput = useRef(null);
  const candidateInput = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [recordData, shortlistData] = await Promise.all([
        request("/api/records"),
        request("/api/shortlist"),
      ]);
      setRecords(recordData.records);
      setShortlist(shortlistData.items);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("smartvision-theme", theme);
    } catch (storageError) {
      if (!(storageError instanceof DOMException && storageError.name === "SecurityError")) {
        setError("The color theme changed, but this browser could not save the preference.");
        return;
      }
      setNotice("The color theme is active for this session, but browser storage is blocked.");
    }
  }, [theme]);

  const pendingShortlist = useMemo(
    () => shortlist.filter((item) => item.status === "NEEDS REVIEW"),
    [shortlist],
  );
  const filteredRecords = useMemo(() => records.filter((record) => (
    (filters.batch === "All batches" || record.batch_id === filters.batch)
    && (filters.decision === "All outcomes" || record.decision === filters.decision)
  )), [records, filters]);
  const batchOptions = useMemo(
    () => [...new Set(records.map((record) => record.batch_id).filter(Boolean))].sort(),
    [records],
  );
  const flaggedCount = records.filter((record) => ["REVIEW REQUIRED", "REJECT", "MANUAL REVIEW"].includes(record.decision)).length;

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function setFile(kind, file) {
    setFiles((current) => ({ ...current, [kind]: file || null }));
    setResult(null);
    setError("");
  }

  async function analyze(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setResult(null);
    if (!files.reference || !files.candidate) {
      setError("Upload both a known-good reference and an item image.");
      return;
    }
    if (!form.batchId.trim()) {
      setError("Enter a batch / lot ID before analysis.");
      return;
    }
    const payload = new FormData();
    payload.append("reference", files.reference);
    payload.append("candidate", files.candidate);
    payload.append("batchId", form.batchId);
    payload.append("partId", form.partId);
    payload.append("product", category);
    payload.append("operator", operator || "Quality Supervisor");
    payload.append("notes", form.notes);
    for (const [key, value] of Object.entries(settings)) payload.append(key, value);
    setAnalyzing(true);
    try {
      const data = await request("/api/analyze", { method: "POST", body: payload });
      setResult(data.result);
      await refresh();
      setNotice(data.result.shortlistId ? "Flagged item added to your review shortlist." : "Analysis complete. Review the result before saving.");
    } catch (analysisError) {
      setError(analysisError.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveRecord() {
    setError("");
    try {
      await request("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: result.id, approvedBy: reviewer }),
      });
      setNotice("Inspection saved to the item-level quality log.");
      setResult(null);
      setApproved(false);
      setReviewer("");
      await refresh();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function updateShortlist(id, status) {
    setError("");
    try {
      await request(`/api/shortlist/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setNotice(status === "CLEARED" ? "Item marked as cleared." : "Item returned to the review shortlist.");
      await refresh();
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  function startInspection() {
    setPage("inspect");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage("overview")} aria-label="SmartVision overview">
          <span className="brand-mark">S<span>V</span></span>
          <span><strong>smartvision</strong><small>QUALITY, MADE VISIBLE</small></span>
        </button>
        <div className="nav-section">WORKSPACE</div>
        <nav className="navigation" aria-label="Main navigation">
          {navigation.map((item) => (
            <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => { setPage(item.id); setError(""); }}>
              <span className="nav-glyph">{item.icon}</span><span>{item.label}</span>
              {item.id === "shortlist" && pendingShortlist.length > 0 && <span className="nav-count">{pendingShortlist.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="prototype-card"><span className="status-dot" />Local prototype<span>Images are screened on this device’s server.</span></div>
          <div className="profile">
            <div className="avatar">{(operator || "Q").slice(0, 1).toUpperCase()}</div>
            <label>INSPECTOR<input aria-label="Inspector name" value={operator} placeholder="Quality Supervisor" onChange={(event) => setOperator(event.target.value)} /></label>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>SmartVision</span><span className="crumb-slash">/</span><strong>{navigation.find((item) => item.id === page)?.label}</strong></div>
          <div className="topbar-actions">
            <span className="environment-tag"><span className="status-dot" />WORKSPACE READY</span>
            <button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title="Toggle color theme">
              <Icon name={theme === "light" ? "moon" : "sun"} />
            </button>
          </div>
        </header>

        <div className="page-wrap">
          {error && <div className="toast error-toast" role="alert"><Icon name="close" />{error}<button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="close" /></button></div>}
          {notice && <div className="toast notice-toast" role="status"><Icon name="check" />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification"><Icon name="close" /></button></div>}
          {page === "overview" && <Overview records={records} pendingCount={pendingShortlist.length} flaggedCount={flaggedCount} loading={loading} onStart={startInspection} onNavigate={setPage} />}
          {page === "inspect" && (
            <InspectionStudio
              category={category} setCategory={setCategory} form={form} updateForm={updateForm}
              files={files} setFile={setFile} settings={settings} setSettings={setSettings}
              operator={operator} setOperator={setOperator}
              analyzing={analyzing} analyze={analyze} result={result} reviewer={reviewer}
              setReviewer={setReviewer} approved={approved} setApproved={setApproved}
              saveRecord={saveRecord} referenceInput={referenceInput} candidateInput={candidateInput}
              onShortlist={() => setPage("shortlist")}
            />
          )}
          {page === "shortlist" && <Shortlist items={shortlist} onUpdate={updateShortlist} loading={loading} />}
          {page === "records" && (
            <Records records={filteredRecords} batches={batchOptions} filters={filters} setFilters={setFilters}
              loading={loading} onRefresh={refresh} />
          )}
          {page === "guide" && <Guide />}
          <footer className="page-footer"><span>SMARTVISION · HUMAN-REVIEWED QUALITY SCREENING</span><span>Prototype · Not a certification instrument</span></footer>
        </div>
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Overview({ records, pendingCount, flaggedCount, loading, onStart, onNavigate }) {
  const batches = new Set(records.map((record) => record.batch_id)).size;
  return (
    <>
      <div className="overview-hero">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="hero-kicker-dot" />THE QUALITY GAP · 4.2</div>
          <h1>Manual inspection lets defects through—and keeps small units out of bigger supply chains.</h1>
          <p>Inspection by eye misses <strong>10–15% of defects</strong>, while industrial machine vision is too costly for small units. They can’t show the <em>consistent quality</em> larger buyers demand.</p>
          <div className="hero-actions"><button className="button-primary" onClick={onStart}>Start an inspection <Icon name="arrow" /></button><span>Simple, human-reviewed visual screening</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-glow" /><div className="art-frame">
            <div className="art-topline"><span>VISION SYSTEM</span><span className="scan-state"><i /> SCANNING</span></div>
            <div className="sample-part"><div className="part-body"><div className="part-hole" /><div className="part-hole second" /><div className="part-edge" /></div><div className="scan-line" /><div className="scan-target target-one" /><div className="scan-target target-two" /></div>
            <div className="art-readout"><span><i className="readout-dot green" /> REFERENCE MATCH</span><strong>VISUAL CHECK <b>READY</b></strong></div>
          </div>
          <div className="floating-chip"><span className="chip-check">✓</span><span><b>Inspector in control</b><small>Review every flagged item</small></span></div>
        </div>
        <div className="hero-index">SV / 01 <span>QUALITY SYSTEMS</span></div>
      </div>

      <div className="section-title-row"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>A clearer path to consistent quality</h2></div><button className="text-button" onClick={() => onNavigate("guide")}>How it works <Icon name="arrow" /></button></div>
      <div className="process-grid">
        <ProcessCard number="01" title="Compare" text="Pair an item with a known-good reference image." accent="mint" />
        <ProcessCard number="02" title="Review" text="See highlighted differences before taking action." accent="amber" />
        <ProcessCard number="03" title="Shortlist" text="Keep flagged items together for human review." accent="blue" />
        <ProcessCard number="04" title="Record" text="Save item-level evidence after supervisor sign-off." accent="violet" />
      </div>
      <div className="dashboard-row">
        <div className="dashboard-intro"><div className="eyebrow">LIVE WORKSPACE</div><h2>Quality activity</h2><p>Inspection logs stay local to this app.</p></div>
        <div className="dashboard-stat"><span>ITEMS INSPECTED</span><strong>{loading ? "—" : records.length}</strong><small>Total saved records</small></div>
        <div className="dashboard-stat"><span>NEEDS REVIEW</span><strong>{loading ? "—" : pendingCount}</strong><small>On the current shortlist</small></div>
        <div className="dashboard-stat"><span>FLAGGED ITEMS</span><strong>{loading ? "—" : flaggedCount}</strong><small>Saved for supervisor review</small></div>
        <div className="dashboard-stat"><span>BATCHES</span><strong>{loading ? "—" : batches}</strong><small>With saved inspection logs</small></div>
      </div>
      <div className="caution-strip"><span>!</span><p><strong>A screening aid—not a guarantee.</strong> Visual differences can come from camera movement or lighting, and subtle defects may be missed. Validate results with real production images.</p><button onClick={() => onNavigate("guide")}>Read limitations <Icon name="arrow" /></button></div>
    </>
  );
}

function ProcessCard({ number, title, text, accent }) {
  return <div className={`process-card accent-${accent}`}><div className="process-card-top"><span>{number}</span><span className="process-marker" /></div><h3>{title}</h3><p>{text}</p></div>;
}

function UploadCard({ title, description, file, inputRef, onChange }) {
  const previewUrl = useObjectUrl(file);
  return (
    <div className={`upload-card ${file ? "has-file" : ""}`}>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const selectedFile = event.target.files?.[0] || null; event.target.value = ""; onChange(selectedFile); }} />
      <button type="button" className="upload-target" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onChange(event.dataTransfer.files?.[0] || null); }}>
        {file ? <img src={previewUrl} alt={`${title} preview`} /> : <span className="upload-icon"><Icon name="upload" /></span>}
      </button>
      <div className="upload-copy"><b>{title}</b><span>{file ? file.name : description}</span><button type="button" className="upload-link" onClick={() => inputRef.current?.click()}>{file ? "Replace image" : "Choose image"}</button></div>
      {file && <button className="remove-file" onClick={() => onChange(null)} aria-label={`Remove ${title}`}><Icon name="close" /></button>}
    </div>
  );
}

function InspectionStudio(props) {
  const { category, setCategory, form, updateForm, files, setFile, settings, setSettings, analyzing, analyze, result, reviewer, setReviewer, approved, setApproved, saveRecord, referenceInput, candidateInput, onShortlist } = props;
  const [imageTab, setImageTab] = useState("overlay");
  const resultImage = result ? { candidate: result.candidateUrl, overlay: result.overlayUrl, heatmap: result.heatmapUrl }[imageTab] : "";
  const isFlagged = result?.decision === "REVIEW REQUIRED";
  return (
    <>
      <PageHeading eyebrow="INSPECTION WORKSPACE · 01 / 04" title="Inspection studio" description="Compare a product against its known-good reference. Review every flag before recording a decision." />
      <form className="inspection-layout" onSubmit={analyze}>
        <div className="inspection-main">
          <section className="surface-card">
            <div className="card-heading"><span className="step-number">01</span><div><h2>Identify this inspection</h2><p>Give every image pair a batch and item context.</p></div></div>
            <div className="form-grid">
              <label className="field-label">BATCH / LOT ID<input required name="batchId" value={form.batchId} onChange={updateForm} placeholder="e.g. LOT-2026-014" /></label>
              <label className="field-label">PART / SKU <span className="optional">OPTIONAL</span><input name="partId" value={form.partId} onChange={updateForm} placeholder="e.g. BRACKET-A12" /></label>
              <label className="field-label">PRODUCT CATEGORY<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="field-label">INSPECTOR<input value={props.operator} onChange={(event) => props.setOperator(event.target.value)} placeholder="Quality Supervisor" /></label>
              <label className="field-label full-width">NOTES <span className="optional">OPTIONAL</span><textarea name="notes" value={form.notes} onChange={updateForm} placeholder="Production line, shift, material, or what you noticed…" rows="3" /></label>
            </div>
          </section>

          <section className="surface-card">
            <div className="card-heading"><span className="step-number">02</span><div><h2>Add comparison images</h2><p>Use similar lighting, angle, distance, and framing for both.</p></div></div>
            <div className="upload-grid">
              <UploadCard title="Known-good reference" description="Drop image or browse · PNG, JPG, WebP" file={files.reference} inputRef={referenceInput} onChange={(file) => setFile("reference", file)} />
              <UploadCard title="Item to inspect" description="Drop image or browse · PNG, JPG, WebP" file={files.candidate} inputRef={candidateInput} onChange={(file) => setFile("candidate", file)} />
            </div>
            <div className="image-hint"><span>i</span> Images with different framing can create false flags. The comparison runs on your app’s Node server.</div>
          </section>

          <section className="surface-card settings-card">
            <div className="card-heading"><span className="step-number">03</span><div><h2>Set screening sensitivity</h2><p>Start with defaults; tune using representative images.</p></div></div>
            <RangeSetting label="Difference sensitivity" value={settings.threshold} min={5} max={60} onChange={(value) => setSettings((current) => ({ ...current, threshold: value }))} note="Lower values highlight more differences." />
            <RangeSetting label="Minimum region size" value={settings.minArea} min={10} max={500} step={5} onChange={(value) => setSettings((current) => ({ ...current, minArea: value }))} note="Smaller regions are filtered out." />
            <RangeSetting label="Review score threshold" value={settings.reviewThreshold} min={5} max={100} onChange={(value) => setSettings((current) => ({ ...current, reviewThreshold: value }))} note="This score is not a probability." />
          </section>
          <button type="submit" className="button-primary analyze-button" disabled={analyzing}>{analyzing ? <><span className="spinner" /> Comparing images…</> : <>Analyze images <Icon name="arrow" /></>}</button>
        </div>

        <aside className="inspection-aside">
          <div className="aside-callout"><span className="callout-icon">◎</span><h3>Human judgement stays in control</h3><p>SmartVision highlights differences, not defect probabilities. An inspector reviews every item before a record is saved.</p></div>
          <div className="aside-steps"><span className="eyebrow">THE FLOW</span><div><i className="flow-done">✓</i><span>Set the inspection context</span></div><div><i className={files.reference && files.candidate ? "flow-done" : ""}>{files.reference && files.candidate ? "✓" : "2"}</i><span>Compare matched images</span></div><div><i className={result ? "flow-done" : ""}>{result ? "✓" : "3"}</i><span>Review, shortlist, record</span></div></div>
          <div className="aside-tip"><b>GOOD COMPARISON TIP</b><p>Fix the camera position, keep the same light source, and center the product the same way in each image.</p></div>
        </aside>
      </form>

      {result && <section className="result-section">
        <div className={`result-heading ${isFlagged ? "result-flagged" : "result-clear"}`}><div><span className="eyebrow">ANALYSIS COMPLETE · HUMAN REVIEW REQUIRED</span><h2>{isFlagged ? "Differences to review" : "No flags detected"}</h2><p>{isFlagged ? "This item was automatically added to your review shortlist." : "No differences crossed the current screening settings. This is not proof of defect-free quality."}</p></div><span className="result-badge">{isFlagged ? "REVIEW" : "NO FLAGS"}</span></div>
        <div className="result-metrics"><ResultMetric label="Difference score" value={result.score.toFixed(1)} detail="Comparative, not probability" /><ResultMetric label="Flagged regions" value={result.count} detail="Above minimum region size" /><ResultMetric label="Flagged pixel area" value={`${result.coverage.toFixed(2)}%`} detail="Of the compared image" /><ResultMetric label="Image dimensions" value={`${result.width} × ${result.height}`} detail="Analysis resolution" /></div>
        <div className="visual-review surface-card">
          <div className="visual-review-heading"><div><h3>Review visual evidence</h3><p>Click between candidate, flagged regions, and the difference map.</p></div>{isFlagged && <button className="text-button" onClick={onShortlist}>Open review shortlist <Icon name="arrow" /></button>}</div>
          <div className="visual-tabs">{[["candidate", "Candidate image"], ["overlay", "Flagged regions"], ["heatmap", "Difference map"]].map(([key, label]) => <button key={key} className={imageTab === key ? "selected" : ""} onClick={() => setImageTab(key)}>{label}</button>)}</div>
          <div className="visual-frame"><img src={resultImage} alt={imageTab === "candidate" ? "Candidate image" : imageTab === "overlay" ? "Candidate image with flagged regions outlined" : "Difference heatmap"} /></div>
          <div className="visual-caption"><span><i className="legend-flag" />Flagged region</span><span>Compare with the known-good image before deciding.</span></div>
        </div>
        <div className="signoff-card surface-card">
          <div className="signoff-copy"><span className="step-number">04</span><div><h3>Supervisor review & sign-off</h3><p>This record represents only this inspected item; it does not certify the full batch.</p></div></div>
          <div className="signoff-fields"><label className="field-label">APPROVED BY<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="Enter supervisor name" /></label><label className="approval-check"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>I have reviewed the image and approve saving this item-level record.</span></label></div>
          <button className="button-primary save-button" disabled={!approved || !reviewer.trim()} onClick={saveRecord}>Save inspection record <Icon name="arrow" /></button>
        </div>
      </section>}
    </>
  );
}

function RangeSetting({ label, value, min, max, step = 1, onChange, note }) {
  return <label className="range-setting"><span className="range-top"><b>{label}</b><output>{value}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><span className="range-note">{note}</span></label>;
}

function ResultMetric({ label, value, detail }) {
  return <div className="result-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Shortlist({ items, onUpdate, loading }) {
  const [filter, setFilter] = useState("NEEDS REVIEW");
  const visible = filter === "ALL" ? items : items.filter((item) => item.status === filter);
  return (
    <>
      <PageHeading eyebrow="HUMAN REVIEW · 02 / 04" title="Review shortlist" description="Flagged items stay here until a supervisor reviews and clears or records them." />
      <div className="shortlist-toolbar"><div className="filter-pills">{[["NEEDS REVIEW", "Needs review"], ["CLEARED", "Cleared"], ["ALL", "All items"]].map(([key, label]) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}<span>{key === "ALL" ? items.length : items.filter((item) => item.status === key).length}</span></button>)}</div><span className="muted small-text">{items.length} flagged {items.length === 1 ? "item" : "items"}</span></div>
      {loading ? <LoadingState /> : visible.length === 0 ? <EmptyState title={filter === "NEEDS REVIEW" ? "Your review list is clear" : "No items in this view"} text={filter === "NEEDS REVIEW" ? "Items with image differences will appear here automatically after analysis." : "Try another filter to see shortlist activity."} /> : <div className="shortlist-list">{visible.map((item) => <article className="shortlist-item surface-card" key={item.id}><img className="shortlist-image" src={item.overlayUrl} alt="Flagged image preview" /><div className="shortlist-info"><div className="shortlist-item-top"><span className={`status-pill ${item.status === "CLEARED" ? "pill-cleared" : item.status === "RECORD SAVED" ? "pill-saved" : "pill-review"}`}><i />{item.status}</span><span className="shortlist-date">{new Date(item.createdAt).toLocaleString()}</span></div><h3>{item.partId || item.product} <span>·</span> {item.batchId}</h3><div className="shortlist-details"><span><b>{item.count}</b> flagged regions</span><span><b>{item.score.toFixed(1)}</b> difference score</span><span><b>{item.coverage.toFixed(2)}%</b> flagged area</span></div><div className="shortlist-actions">{item.status === "NEEDS REVIEW" ? <button className="button-secondary" onClick={() => onUpdate(item.id, "CLEARED")}><Icon name="check" /> Mark reviewed & clear</button> : item.status === "CLEARED" && <button className="text-button" onClick={() => onUpdate(item.id, "NEEDS REVIEW")}>Return to review</button>}</div></div></article>)}</div>}
    </>
  );
}

function Records({ records, batches, filters, setFilters, loading, onRefresh }) {
  const outcomes = [...new Set(records.map((record) => record.decision).filter(Boolean))];
  const allOutcomes = [...new Set([...outcomes, "REVIEW REQUIRED", "NO FLAGS DETECTED"])].sort();
  return (
    <>
      <PageHeading eyebrow="TRACEABILITY · 03 / 04" title="Inspection records" description="A searchable, item-level history for your team. Export records to share inspection evidence." action={<a className="button-secondary download-link" href="/api/records.csv" download>↓&nbsp; Export CSV</a>} />
      <div className="record-summary"><div><span>ITEMS IN VIEW</span><b>{records.length}</b></div><div><span>FLAGGED FOR REVIEW</span><b>{records.filter((record) => record.decision === "REVIEW REQUIRED").length}</b></div><div><span>UNIQUE BATCHES</span><b>{new Set(records.map((record) => record.batch_id)).size}</b></div><button className="button-secondary" onClick={onRefresh}>↻&nbsp; Refresh records</button></div>
      <div className="records-table-card surface-card"><div className="records-toolbar"><div><h2>Quality log</h2><p>Saved after supervisor review</p></div><div className="record-filters"><label><span className="sr-only">Filter batch</span><select value={filters.batch} onChange={(event) => setFilters((current) => ({ ...current, batch: event.target.value }))}><option>All batches</option>{batches.map((batch) => <option key={batch}>{batch}</option>)}</select></label><label><span className="sr-only">Filter outcome</span><select value={filters.decision} onChange={(event) => setFilters((current) => ({ ...current, decision: event.target.value }))}><option>All outcomes</option>{allOutcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}</select></label></div></div>
        {loading ? <LoadingState /> : records.length === 0 ? <EmptyState title="No inspection records yet" text="Complete an image inspection and save it after supervisor sign-off." /> : <div className="table-scroll"><table><thead><tr><th>ITEM / BATCH</th><th>DATE & TIME</th><th>OUTCOME</th><th>SCORE</th><th>REGIONS</th><th>INSPECTOR</th></tr></thead><tbody>{records.map((record) => <tr key={record.inspection_id}><td><b>{record.product || "Item"}</b><small>{record.batch_id}{record.image_name ? ` · ${record.image_name}` : ""}</small></td><td>{new Date(record.timestamp).toLocaleString()}</td><td><span className={`table-decision ${record.decision === "NO FLAGS DETECTED" ? "decision-clear" : "decision-flag"}`}><i />{record.decision}</span></td><td>{Number(record.anomaly_score || 0).toFixed(1)}</td><td>{record.flagged_regions ?? "—"}</td><td>{record.operator || "—"}</td></tr>)}</tbody></table></div>}
        <div className="table-footnote">These are inspection logs, not third-party certification.</div>
      </div>
    </>
  );
}

function Guide() {
  return <><PageHeading eyebrow="PRODUCT NOTES · 04 / 04" title="How this screening works" description="A transparent first step for visual comparison—not a black-box quality verdict." />
    <div className="guide-grid"><div className="guide-main surface-card"><span className="eyebrow">THE COMPARISON</span><h2>Reference-based image screening</h2><p>The Node service decodes and aligns each uploaded image pair, then compares colour and edge changes. It turns significant differences into highlighted regions and a heatmap for a person to review.</p><div className="guide-flow"><ProcessCard number="01" title="Align" text="Normalize orientation and match image framing." accent="mint" /><ProcessCard number="02" title="Compare" text="Score local colour and edge differences." accent="amber" /><ProcessCard number="03" title="Review" text="Highlight regions for human inspection." accent="blue" /></div><div className="guide-notice"><b>Important:</b> the difference score is not a defect probability, and this tool does not know whether a visible change is a manufacturing defect.</div></div>
      <aside className="guide-limitations surface-card"><div className="eyebrow">BEFORE YOU USE IT</div><h3>Know what can go wrong</h3><ul><li>Lighting, angle, scale, and product position differences can cause false flags.</li><li>Legitimate variation can look like a defect to a pixel comparison.</li><li>Subtle defects may not create enough image contrast to be flagged.</li><li>A sample inspection does not certify every item in a batch.</li></ul><h3>For production readiness</h3><p>Collect expert-labelled images from one product family; test on held-out factory images; measure precision, recall, false-accept, and false-reject rates; and have the quality owner approve the policy.</p></aside></div>
  </>;
}

function EmptyState({ title, text }) {
  return <div className="empty-state"><div className="empty-icon">◌</div><h3>{title}</h3><p>{text}</p></div>;
}

function LoadingState() {
  return <div className="loading-state"><span className="spinner" /> Loading workspace data…</div>;
}

export default App;
