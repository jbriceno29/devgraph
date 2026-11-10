use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{atomic::{AtomicU64, Ordering}, mpsc::{self, Receiver}, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager, State};
#[cfg(not(debug_assertions))]
use tauri::path::BaseDirectory;

static NEXT_REQUEST_ID:AtomicU64=AtomicU64::new(1);

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRequest { pub channel:String, pub args:Vec<Value> }

#[derive(Debug, Deserialize)]
struct SidecarEnvelope { id:Option<String>, ok:Option<bool>, result:Option<Value>, error:Option<String>, #[serde(rename = "type")] kind:Option<String>, channel:Option<String>, payload:Option<Value> }

#[derive(Clone)]
struct SidecarProcess(Arc<Mutex<SidecarInner>>);
struct SidecarInner { child:Child, stdin:ChildStdin, lines:Receiver<String> }

impl Drop for SidecarInner { fn drop(&mut self) { let _=self.child.kill(); } }

#[tauri::command]
async fn workspace_request(sidecar:State<'_,SidecarProcess>,request:WorkspaceRequest)->Result<Value,String> {
    let sidecar=sidecar.inner().clone();
    tauri::async_runtime::spawn_blocking(move||execute_workspace_request(&sidecar,request))
        .await.map_err(|error|format!("Workspace request worker failed: {error}"))?
}

fn execute_workspace_request(sidecar:&SidecarProcess,request:WorkspaceRequest)->Result<Value,String> {
    let request_id=format!("req-{}",NEXT_REQUEST_ID.fetch_add(1,Ordering::Relaxed));
    let encoded=serde_json::json!({"id":request_id,"request":request}).to_string();
    let mut inner=sidecar.0.lock().map_err(|_|"Workspace sidecar lock was poisoned")?;
    writeln!(inner.stdin,"{encoded}").map_err(|error|format!("Send request to TypeScript workspace core: {error}"))?;
    inner.stdin.flush().map_err(|error|format!("Flush request to TypeScript workspace core: {error}"))?;
    loop {
        let line=inner.lines.recv_timeout(Duration::from_secs(60)).map_err(|error|format!("Read TypeScript workspace response: {error}"))?;
        let envelope:SidecarEnvelope=serde_json::from_str(&line).map_err(|error|format!("Invalid workspace core response: {error}"))?;
        if envelope.id.as_deref()!=Some(request_id.as_str()) { continue; }
        if envelope.ok!=Some(true) { return Err(envelope.error.unwrap_or_else(||"Workspace core request failed.".to_string())); }
        return envelope.result.ok_or_else(||"Workspace core returned no result.".to_string());
    }
}

fn spawn_sidecar(app:&tauri::AppHandle)->Result<SidecarProcess,String> {
    let workspace_root=app.path().app_data_dir().map_err(|error|format!("Resolve application data directory: {error}"))?;
    std::fs::create_dir_all(&workspace_root).map_err(|error|format!("Create application data directory: {error}"))?;
    #[cfg(debug_assertions)]
    let (program,script,working_directory)={
        let repository_root=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().ok_or("Resolve repository root")?.to_path_buf();
        ("node".to_string(),repository_root.join("dist/main/infrastructure/ipc/sidecar/main.js"),repository_root.join("dist/main"))
    };
    #[cfg(not(debug_assertions))]
    let (program,script,working_directory)={
        let root=app.path().resolve(".",BaseDirectory::Resource).map_err(|error|format!("Resolve application resources: {error}"))?;
        (root.join("node").to_string_lossy().into_owned(),root.join("core/infrastructure/ipc/sidecar/main.js"),root.join("core"))
    };
    if !script.is_file() { return Err(format!("Workspace core is missing at {}. Run the Tauri development/build command so the TypeScript core is compiled.",script.display())); }
    let mut child=Command::new(&program).arg(&script).current_dir(&working_directory)
        .env("GRAPHDEV_WORKSPACE_ROOT",workspace_root)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|error|format!("Start TypeScript workspace core ({program}): {error}"))?;
    let stdin=child.stdin.take().ok_or("Workspace core stdin was unavailable")?;
    let stdout=child.stdout.take().ok_or("Workspace core stdout was unavailable")?;
    let stderr=child.stderr.take().ok_or("Workspace core stderr was unavailable")?;
    let (sender,lines)=mpsc::channel();
    let event_app=app.clone();
    thread::spawn(move||{
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line)=>{
                    if let Ok(envelope)=serde_json::from_str::<SidecarEnvelope>(&line) {
                        if envelope.kind.as_deref()==Some("event") {
                            if let Some(channel)=envelope.channel { let _=event_app.emit(&channel,envelope.payload.unwrap_or(Value::Null)); }
                            continue;
                        }
                    }
                    if sender.send(line).is_err(){break}
                }
                Err(_)=>break,
            }
        }
    });
    thread::spawn(move||{let mut stderr=stderr;let _=std::io::copy(&mut stderr,&mut std::io::sink());});
    Ok(SidecarProcess(Arc::new(Mutex::new(SidecarInner{child,stdin,lines}))))
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app|{
            let sidecar=spawn_sidecar(app.handle()).map_err(std::io::Error::other)?;
            app.manage(sidecar);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![workspace_request])
        .run(tauri::generate_context!())
        .expect("failed to run Graphdev2 Tauri host");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_wire_format_uses_camel_case() {
        let request=WorkspaceRequest{channel:"project:list".into(),args:vec![]};
        let value=serde_json::to_value(request).unwrap();
        assert_eq!(value["channel"],"project:list");
        assert_eq!(value["args"],serde_json::json!([]));
    }
}
