
// Petit script pour imprimer / télécharger le contenu en Markdown simple
function toMarkdown(title, htmlContent){
  // Très simple transformation : retire balises et garde titres
  const tmp = document.createElement('div');
  tmp.textContent = htmlContent;
  const text = tmp.innerText.replace(/\r\n/g,'\n');
  return `# ${title}\n\n${text}\n`;
}

function attachControls(printId, downloadId, title){
  const p = document.getElementById(printId);
  const d = document.getElementById(downloadId);
  if(p) p.addEventListener('click', () => window.print());
  if(d) d.addEventListener('click', () => {
    const body = document.querySelector('.container section');
    const md = toMarkdown(title, body.textContent);
    const blob = new Blob([md], {type:'text/markdown;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title.replace(/\s+/g,'_')}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });
}

// replace placeholders if present
document.addEventListener('DOMContentLoaded', () => {
  // Optionally you can set these values here programmatically:
  const date = '%%DATE%%';
  const contact = '%%CONTACT_EMAIL%%';
  const juris = '%%JURISDICTION%%';
  // If you left placeholders, nothing harmful — editor can replace these.
  // Attach controls:
  attachControls('printBtn','downloadBtn','Conditions_Générales_MoodShare');
  attachControls('printBtn2','downloadBtn2','Politique_de_confidentialité_MoodShare');
});