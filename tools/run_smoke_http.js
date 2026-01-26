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
  out = execSync(`curl -s -X POST -d "plan_id=8" "https://survey.defecttracker.uk/api/export_report.php"`, {encoding: 'utf8'});
  console.log('export pdf:', out);
} catch (e) {
  console.error('error:', e.stdout ? e.stdout : e.message);
} finally {
  fs.unlinkSync(tmp);
}
