const $ = id => document.getElementById(id);
const claim = $("claim"), checkBtn = $("checkBtn");
let latestReport = null;
claim.addEventListener("input", () => $("counter").textContent = `${claim.value.length} / 6000`);
$("clearBtn").addEventListener("click", () => { claim.value=""; $("counter").textContent="0 / 6000"; $("error").hidden=true; $("results").hidden=true; claim.focus(); });
checkBtn.addEventListener("click", analyse);
claim.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") analyse(); });

async function analyse(){
  const text = claim.value.trim();
  $("error").hidden = true;
  if(text.length < 20){ showError("Please enter a fuller claim (at least 20 characters) so it can be assessed fairly."); return; }
  checkBtn.disabled = true; $("loading").hidden = false; $("results").hidden = true;
  try{
    const response = await fetch("/.netlify/functions/check-news", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({claim:text})});
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "The analysis could not be completed.");
    latestReport = data; render(data);
    $("results").hidden = false;
    $("results").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(err){ showError(err.message || "Something went wrong. Please try again."); }
  finally{ checkBtn.disabled=false; $("loading").hidden=true; }
}
function showError(message){ $("error").textContent=message; $("error").hidden=false; }
function list(id, items, fallback){
  const el=$(id); el.innerHTML="";
  (Array.isArray(items)&&items.length?items:[fallback]).forEach(item=>{const li=document.createElement("li");li.textContent=typeof item==="string"?item:JSON.stringify(item);el.appendChild(li);});
}
function render(d){
  const styles={true:{icon:"✓",color:"#79d8b5",title:"Likely true"},false:{icon:"×",color:"#ef8d8d",title:"Likely false"},misleading:{icon:"!",color:"#e9c77b",title:"Misleading"},unverified:{icon:"?",color:"#9db4d0",title:"Unverified"}};
  const v=styles[d.verdict]||styles.unverified;
  $("verdict").textContent=v.title; $("verdictIcon").textContent=v.icon; $("verdictIcon").style.color=v.color;
  $("summary").textContent=d.summary||"The available evidence does not support a stronger conclusion.";
  const score=Math.max(0,Math.min(100,Number(d.confidence)||0));
  $("confidence").textContent=`${score}% confidence`; $("meterFill").style.width=score+"%"; $("meterFill").style.background=v.color;
  $("confidenceNote").textContent=d.confidence_note||"Confidence reflects the strength and consistency of the evidence found, not the probability that the claim is true.";
  list("claimsList",d.claims,"No separate subclaims were identified.");
  list("forList",d.supporting_evidence,"No reliable supporting evidence was found.");
  list("againstList",d.contrary_evidence,"No reliable contrary evidence was found.");
  $("context").textContent=d.context||"No additional context was returned.";
  $("limitations").textContent=d.limitations||"Check the original sources and publication dates before relying on this assessment.";
  const ol=$("sourcesList");ol.innerHTML="";
  const sources=Array.isArray(d.sources)?d.sources:[];
  sources.forEach(s=>{const li=document.createElement("li");const a=document.createElement("a");a.textContent=s.title||s.url||"Source";a.href=s.url||"#";a.target="_blank";a.rel="noopener noreferrer";li.appendChild(a);if(s.publisher||s.date){const meta=document.createElement("div");meta.className="source-meta";meta.textContent=[s.publisher,s.date].filter(Boolean).join(" · ");li.appendChild(meta);}if(s.relevance){const p=document.createElement("div");p.className="source-meta";p.textContent=s.relevance;li.appendChild(p);}ol.appendChild(li);});
  $("noSources").hidden=sources.length>0;
}
$("copyBtn").addEventListener("click",async()=>{
  if(!latestReport)return;
  const d=latestReport;
  const text=`VERITY NEWS CHECK\nVerdict: ${d.verdict}\nConfidence: ${d.confidence}%\nSummary: ${d.summary}\n\nSupporting evidence:\n${(d.supporting_evidence||[]).map(x=>"• "+x).join("\n")}\n\nContrary evidence:\n${(d.contrary_evidence||[]).map(x=>"• "+x).join("\n")}\n\nContext: ${d.context}\n\nSources:\n${(d.sources||[]).map(s=>`${s.title||"Source"} — ${s.url||""}`).join("\n")}\n\nAI-assisted preliminary assessment. Verify sources independently.`;
  const btn=$("copyBtn");try{await navigator.clipboard.writeText(text);btn.textContent="Copied ✓";setTimeout(()=>btn.textContent="Copy report ↗",1600);}catch{btn.textContent="Copy unavailable";}
});