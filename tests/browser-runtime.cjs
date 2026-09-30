const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'playwright');

// Run browser tests from the repository root, like the build and npm scripts.
// Every test creates its own browser/context; only runtime setup is shared.
async function launchBrowser(options={}){
  fs.mkdirSync('qa',{recursive:true});
  const launchOptions={headless:true,...options};
  if(process.env.BROWSER_PATH)launchOptions.executablePath=process.env.BROWSER_PATH;
  return chromium.launch(launchOptions);
}

function localGameURL(filename='index.html'){
  const gamePath=process.env.GAME_FILE
    ?path.resolve(process.env.GAME_FILE)
    :path.resolve(__dirname,'..',filename);
  return pathToFileURL(gamePath).href;
}

const serverGameURL=process.env.GAME_URL||'http://127.0.0.1:4173/';
module.exports={launchBrowser,localGameURL,serverGameURL};
