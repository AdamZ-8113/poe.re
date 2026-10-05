import {useEffect, useRef, useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {loadMapMods} from "@poe/utils/loadData";
import {createImportProfile, getImportProfileNameError, loadProfileNames, suggestImportProfileName} from "@poe/utils/LocalStorage";
import {generateMapModRegex} from "@poe/pages/maps/OptimizedMapOutput";
import {ImportPreview, parsePobCodesImportPayload, PobCodesImportError, preparePobCodesImport} from "./PobCodesImportPayload";
import {replaceWithMaps} from "./ImportNavigation";
import "./PoeImportPage.css";

type PageState = {kind: "loading"} | {kind: "error"; message: string} | {kind: "cancelled"} | {kind: "ready"; preview: ImportPreview; regex: string};

export default function PoeImportPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Capture in render, before the effect scrubs; Strict Mode retains this state.
  const [request] = useState(() => parsePobCodesImportPayload(`${window.location.origin}${location.pathname}${location.search}${location.hash}`));
  const [state, setState] = useState<PageState>({kind: "loading"});
  const [name, setName] = useState("");
  const [, refreshNames] = useState(0);
  let nameError: string | undefined;
  try { nameError = getImportProfileNameError(name, loadProfileNames()); }
  catch { nameError = "Your browser's profile storage is unavailable."; }
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false);
  const submitted = useRef(false);

  useEffect(() => {
    if (location.search) navigate({pathname: "/import", search: ""}, {replace: true});
  }, [location.search, navigate]);

  useEffect(() => {
    let active = true;
    if (!request.ok) {
      setState({kind: "error", message: request.error});
      return;
    }
    loadMapMods("ENGLISH").then(catalog => {
      if (!active || cancelled.current) return;
      try {
        const preview = preparePobCodesImport(request.payload, catalog);
        let regex: string;
        try {
          regex = generateMapModRegex(preview.profile.map, catalog, "ENGLISH");
          if (!regex) throw new Error("Empty preview");
        } catch { throw new PobCodesImportError("Could not generate the map regex preview. Reload a new import link to try again."); }
        setName(suggestImportProfileName(preview.profile.name));
        setState({kind: "ready", preview, regex});
      } catch (error) {
        setState({kind: "error", message: error instanceof PobCodesImportError ? error.message : "Your browser's profile storage is unavailable. No profile was imported."});
      }
    }).catch(() => {
      if (active && !cancelled.current) setState({kind: "error", message: "Could not load the English modifier catalog. Reload a new import link to try again."});
    });
    return () => { active = false; };
  }, [request]);

  const cancel = () => {
    if (submitted.current) return;
    cancelled.current = true;
    setState({kind: "cancelled"});
    setName("");
    setSaveError(undefined);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const onStorage = () => refreshNames(revision => revision + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const confirm = (event: React.FormEvent) => {
    event.preventDefault();
    if (state.kind !== "ready" || nameError || submitted.current) return;
    submitted.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      createImportProfile({...state.preview.profile, name: name.trim()});
    } catch {
      submitted.current = false;
      setSaving(false);
      try {
        const problem = getImportProfileNameError(name, loadProfileNames());
        setSaveError(problem ? `${problem} Choose another name, then try again.` : "The profile could not be saved or verified. Your previous selection is unchanged; check browser storage and try again.");
      } catch { setSaveError("Your browser's profile storage is unavailable. No profile was selected."); }
      return;
    }
    // Never route in-place into /maps with the old profile context mounted.
    replaceWithMaps();
  };

  return <section className="poe-import" aria-labelledby="poe-import-title">
    <h1 id="poe-import-title">Import from PoB Codes</h1>
    <p className="poe-import-intro">Review the map modifiers to exclude before creating a new profile.</p>
    {state.kind === "loading" && <p role="status">Loading modifier preview...</p>}
    {state.kind === "error" && <p className="poe-import-error" role="alert">{state.message}</p>}
    {state.kind === "cancelled" && <p role="status">Import cancelled. No profile was created.</p>}
    {state.kind === "ready" && <form onSubmit={confirm} aria-busy={saving}>
      <div className="poe-import-card">
        <p>Source: <strong>PoB Codes</strong> - Path of Exile 1 - English</p>
        <label htmlFor="poe-import-name">New profile name</label>
        <input id="poe-import-name" value={name} onChange={event => {setName(event.target.value); setSaveError(undefined);}} disabled={saving} aria-invalid={!!nameError} aria-describedby={nameError ? "poe-import-name-error" : "poe-import-name-help"}/>
        <p id="poe-import-name-help" className="poe-import-muted">Your existing profiles will be kept. This creates a separate selection snapshot.</p>
        {nameError && <p id="poe-import-name-error" className="poe-import-error" role="alert">{nameError}</p>}
        <h2>{state.preview.recognized.length} of {request.ok ? request.payload.excludeIds.length : 0} modifiers recognized</h2>
        <ul className="poe-import-modifiers">{state.preview.recognized.map(token => <li key={token.id}>{token.rawText.replaceAll("|", " / ")}{token.options.nm && <span className="poe-import-muted"> (Nightmare)</span>}</li>)}</ul>
        {state.preview.unknownIds.length > 0 && <div className="poe-import-warning" role="status">
          <h2>Unrecognized modifiers will not be imported</h2>
          <p>This link may use a newer catalog. Continue only if the recognized selection is sufficient.</p>
          <ul>{state.preview.unknownIds.map(id => <li key={id}>{id}</li>)}</ul>
        </div>}
        <h2>Map regex preview</h2>
        <pre className="poe-import-regex" aria-label="Map regex preview">{state.regex}</pre>
        {saveError && <p className="poe-import-error" role="alert">{saveError}</p>}
        <div className="poe-import-actions">
          <button className="poe-import-confirm" type="submit" disabled={saving || !!nameError}>{saving ? "Opening maps..." : state.preview.unknownIds.length ? "Import recognized modifiers only" : "Create profile and open maps"}</button>
          <button type="button" onClick={cancel} disabled={saving}>Cancel</button>
        </div>
        {saving && <p role="status">Profile saved. Opening maps...</p>}
      </div>
    </form>}
    {state.kind !== "ready" && state.kind !== "cancelled" && <button type="button" onClick={cancel}>Cancel</button>}
    <Link className="poe-import-maps-link" to="/maps">Go to map modifiers</Link>
  </section>;
}
