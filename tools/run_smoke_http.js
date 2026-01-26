const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');
const tmp = path.join(require('os').tmpdir(), 'smoke_test_tmp.png');
fs.writeFileSync(tmp, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64'));
try {
  console.log('Upload...');
  let out = execSync(`curl -s -F "file=@${tmp}" -F "plan_id=8" -F "issue_id=12" "https://survey.defecttracker.uk/api/upload_photo.php"`, {encoding: 'utf8', stdio: ['ignore','pipe','pipe']});
  console.log('upload response:', out);
  out = execSync(`curl -s "https://survey.defecttracker.uk/api/list_photos.php?plan_id=8"`, {encoding: 'utf8'});
  console.log('list_photos:', out);
  out = execSync(`curl -s -X POST -d "plan_id=8&format=csv" "https://survey.defecttracker.uk/api/export_report.php"`, {encoding: 'utf8'});
  console.log('export csv:', out);
  out = execSync(`curl -s -X POST -d "plan_id=8&debug=1" "https://survey.defecttracker.uk/api/export_report.php"`, {encoding: 'utf8'});
  console.log('export pdf (debug):', out);
  try {
    const res = JSON.parse(out);
    if (!res.ok) throw new Error('export_report returned not ok');
    if (!res.pins_included || res.pins_included <= 0) throw new Error('No pins_included in export');
    if (!res.included_pins || !res.included_pins.some(p => p.method && p.method.indexOf('vector') !== -1)) throw new Error('No vector pins found in included_pins');
    console.log('Vector pins appear to be included by default.');
  } catch (e) {
    console.error('PDF export validation failed:', e.message);
    throw e;
  }
} catch (e) {
  console.error('error:', e.stdout ? e.stdout : e.message);
} finally {
  fs.unlinkSync(tmp);
}
