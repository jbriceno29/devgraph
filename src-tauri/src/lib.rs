use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
#[cfg(not(debug_assertions))]
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager, State};

/// Default wait for a workspace core response.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
/// ChangeSet proposals run an LLM; the TypeScript planner gives up at 300 s, so the host waits a bit longer
/// and the user sees the planner's own message instead of a transport error.
const PROPOSAL_TIMEOUT: Duration = Duration::from_secs(330);

pub fn timeout_for(channel: &str) -> Duration {
    match channel {
        "changeset:propose_from_chat" => PROPOSAL_TIMEOUT,
        _ => DEFAULT_TIMEOUT,
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRequest {
    pub channel: String,
    pub args: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct SidecarEnvelope {
    id: Option<String>,
    ok: Option<bool>,
    result: Option<Value>,
    error: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    channel: Option<String>,
    payload: Option<Value>,
}

type PendingMap = Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>>;

/// Line-delimited JSON client for the TypeScript workspace core.
///
/// Responses are routed to their caller by request id, so concurrent requests never wait on each other
/// and no lock is held while waiting. A response that arrives after its caller timed out is dropped.
pub struct SidecarClient {
    stdin: Mutex<ChildStdin>,
    pending: PendingMap,
    alive: Arc<AtomicBool>,
    next_id: AtomicU64,
    child: Mutex<Child>,
}

impl SidecarClient {
    /// Spawns the core. `on_event` receives `{type:"event"}` messages; stderr is appended to `stderr_log` if given.
    pub fn spawn(
        mut command: Command,
        on_event: impl Fn(String, Value) + Send + 'static,
        stderr_log: Option<PathBuf>,
    ) -> Result<Self, String> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Start TypeScript workspace core: {error}"))?;
        let stdin = child.stdin.take().ok_or("Workspace core stdin was unavailable")?;
        let stdout = child.stdout.take().ok_or("Workspace core stdout was unavailable")?;
        let stderr = child.stderr.take().ok_or("Workspace core stderr was unavailable")?;
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        let (reader_pending, reader_alive) = (pending.clone(), alive.clone());
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(envelope) = serde_json::from_str::<SidecarEnvelope>(&line) else { continue };
                if envelope.kind.as_deref() == Some("event") {
                    if let Some(channel) = envelope.channel {
                        on_event(channel, envelope.payload.unwrap_or(Value::Null));
                    }
                    continue;
                }
                let Some(id) = envelope.id else { continue };
                let sender = reader_pending.lock().ok().and_then(|mut map| map.remove(&id));
                if let Some(sender) = sender {
                    let outcome = if envelope.ok == Some(true) {
                        envelope.result.ok_or_else(|| "Workspace core returned no result.".to_string())
                    } else {
                        Err(envelope.error.unwrap_or_else(|| "Workspace core request failed.".to_string()))
                    };
                    let _ = sender.send(outcome);
                }
            }
            // The core exited: fail every waiting request now instead of letting each one time out.
            reader_alive.store(false, Ordering::SeqCst);
            if let Ok(mut map) = reader_pending.lock() {
                map.clear();
            }
        });

        thread::spawn(move || {
            let mut stderr = stderr;
            let log = stderr_log.and_then(|path| {
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                OpenOptions::new().create(true).append(true).open(path).ok()
            });
            match log {
                Some(mut file) => {
                    let _ = std::io::copy(&mut stderr, &mut file);
                }
                None => {
                    let _ = std::io::copy(&mut stderr, &mut std::io::sink());
                }
            }
        });

        Ok(Self { stdin: Mutex::new(stdin), pending, alive, next_id: AtomicU64::new(1), child: Mutex::new(child) })
    }

    pub fn request(&self, request: WorkspaceRequest) -> Result<Value, String> {
        let timeout = timeout_for(&request.channel);
        self.request_with_timeout(request, timeout)
    }

    pub fn request_with_timeout(&self, request: WorkspaceRequest, timeout: Duration) -> Result<Value, String> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err("El núcleo de la aplicación se detuvo. Reinicia Graph Workspace.".to_string());
        }
        let id = format!("req-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let channel = request.channel.clone();
        let encoded = serde_json::json!({ "id": id, "request": request }).to_string();
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().map_err(|_| "Workspace pending map was poisoned")?.insert(id.clone(), sender);
        let written = self.stdin.lock().map_err(|_| "Workspace core stdin lock was poisoned".to_string()).and_then(|mut stdin| {
            writeln!(stdin, "{encoded}")
                .and_then(|_| stdin.flush())
                .map_err(|error| format!("Send request to TypeScript workspace core: {error}"))
        });
        if let Err(error) = written {
            self.forget(&id);
            return Err(error);
        }
        match receiver.recv_timeout(timeout) {
            Ok(outcome) => outcome,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.forget(&id);
                Err(format!("El núcleo no respondió a {channel} en {} s.", timeout.as_secs()))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("El núcleo de la aplicación se detuvo antes de responder. Reinicia Graph Workspace.".to_string())
            }
        }
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn forget(&self, id: &str) {
        if let Ok(mut map) = self.pending.lock() {
            map.remove(id);
        }
    }
}

impl Drop for SidecarClient {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

type SidecarFactory = Box<dyn Fn() -> Result<SidecarClient, String> + Send + Sync>;

/**
 * Keeps one live core. If it died, the next request starts a new one instead of failing until the app restarts;
 * the request that was in flight when it died still fails (it may have had effects), only later ones are served.
 * Interrupted executions are reconciled by the new core when the project is opened.
 */
pub struct RestartingSidecar {
    factory: SidecarFactory,
    client: Mutex<Arc<SidecarClient>>,
    restarts: AtomicU64,
}

impl RestartingSidecar {
    pub fn new(factory: SidecarFactory) -> Result<Self, String> {
        let client = Arc::new(factory()?);
        Ok(Self { factory, client: Mutex::new(client), restarts: AtomicU64::new(0) })
    }

    fn live_client(&self) -> Result<Arc<SidecarClient>, String> {
        let mut guard = self.client.lock().map_err(|_| "Workspace sidecar lock was poisoned".to_string())?;
        if !guard.is_alive() {
            *guard = Arc::new((self.factory)()?);
            self.restarts.fetch_add(1, Ordering::SeqCst);
        }
        Ok(guard.clone())
    }

    pub fn request(&self, request: WorkspaceRequest) -> Result<Value, String> {
        self.live_client()?.request(request)
    }

    pub fn restarts(&self) -> u64 {
        self.restarts.load(Ordering::SeqCst)
    }
}

#[derive(Clone)]
struct SidecarState(Arc<RestartingSidecar>);

#[tauri::command]
async fn workspace_request(sidecar: State<'_, SidecarState>, request: WorkspaceRequest) -> Result<Value, String> {
    let sidecar = sidecar.inner().0.clone();
    tauri::async_runtime::spawn_blocking(move || sidecar.request(request))
        .await
        .map_err(|error| format!("Workspace request worker failed: {error}"))?
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<SidecarState, String> {
    let workspace_root = app.path().app_data_dir().map_err(|error| format!("Resolve application data directory: {error}"))?;
    std::fs::create_dir_all(&workspace_root).map_err(|error| format!("Create application data directory: {error}"))?;
    #[cfg(debug_assertions)]
    let (program, script, working_directory) = {
        let repository_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().ok_or("Resolve repository root")?.to_path_buf();
        ("node".to_string(), repository_root.join("dist/main/infrastructure/ipc/sidecar/main.js"), repository_root.join("dist/main"))
    };
    #[cfg(not(debug_assertions))]
    let (program, script, working_directory) = {
        let root = app.path().resolve(".", BaseDirectory::Resource).map_err(|error| format!("Resolve application resources: {error}"))?;
        (root.join("node").to_string_lossy().into_owned(), root.join("core/infrastructure/ipc/sidecar/main.js"), root.join("core"))
    };
    if !script.is_file() {
        return Err(format!("Workspace core is missing at {}. Run the Tauri development/build command so the TypeScript core is compiled.", script.display()));
    }
    let event_app = app.clone();
    let factory: SidecarFactory = Box::new(move || {
        let mut command = Command::new(&program);
        command.arg(&script).current_dir(&working_directory).env("GRAPHDEV_WORKSPACE_ROOT", &workspace_root);
        let emitter = event_app.clone();
        SidecarClient::spawn(
            command,
            move |channel, payload| {
                let _ = emitter.emit(&channel, payload);
            },
            Some(workspace_root.join("logs").join("sidecar.log")),
        )
        .map_err(|error| format!("{error} ({program})"))
    });
    Ok(SidecarState(Arc::new(RestartingSidecar::new(factory)?)))
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let sidecar = spawn_sidecar(app.handle()).map_err(std::io::Error::other)?;
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
    use std::time::Instant;

    #[test]
    fn request_wire_format_uses_camel_case() {
        let request = WorkspaceRequest { channel: "project:list".into(), args: vec![] };
        let value = serde_json::to_value(request).unwrap();
        assert_eq!(value["channel"], "project:list");
        assert_eq!(value["args"], serde_json::json!([]));
    }

    #[test]
    fn proposals_get_a_longer_timeout_than_the_planner() {
        assert_eq!(timeout_for("changeset:propose_from_chat"), Duration::from_secs(330));
        assert_eq!(timeout_for("project:list"), Duration::from_secs(60));
    }

    /// A stand-in core: answers `slow` after 1.5 s, `fast` at once, emits an event for `emit`,
    /// never answers `never`, writes to stderr for `log` and exits for `die`.
    const FAKE_CORE: &str = r#"
const rl=require('node:readline').createInterface({input:process.stdin});
const out=v=>process.stdout.write(JSON.stringify(v)+'\n');
rl.on('line',line=>{const {id,request}=JSON.parse(line);const c=request.channel;
 if(c==='slow')setTimeout(()=>out({id,ok:true,result:'slow'}),1500);
 else if(c==='fast')out({id,ok:true,result:'fast'});
 else if(c==='emit'){out({type:'event',channel:'execution:status_changed',payload:{status:'RUNNING'}});out({id,ok:true,result:'emitted'});}
 else if(c==='fail')out({id,ok:false,error:'boom'});
 else if(c==='log'){process.stderr.write('core diagnostic\n');out({id,ok:true,result:'logged'});}
 else if(c==='die')process.exit(3);
});
"#;

    fn fake_core(on_event: impl Fn(String, Value) + Send + 'static, log: Option<PathBuf>) -> Arc<SidecarClient> {
        let mut command = Command::new("node");
        command.arg("-e").arg(FAKE_CORE);
        Arc::new(SidecarClient::spawn(command, on_event, log).expect("node must be installed to run these tests"))
    }

    fn request(channel: &str) -> WorkspaceRequest {
        WorkspaceRequest { channel: channel.into(), args: vec![] }
    }

    #[test]
    fn a_fast_request_is_not_blocked_by_a_slow_one() {
        let client = fake_core(|_, _| {}, None);
        let slow_client = client.clone();
        let slow = thread::spawn(move || slow_client.request(request("slow")));
        thread::sleep(Duration::from_millis(150));
        let started = Instant::now();
        assert_eq!(client.request(request("fast")).unwrap(), "fast");
        assert!(started.elapsed() < Duration::from_millis(1000), "fast waited {:?}", started.elapsed());
        assert_eq!(slow.join().unwrap().unwrap(), "slow");
    }

    #[test]
    fn errors_and_events_are_routed() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let client = fake_core(move |channel, payload| sink.lock().unwrap().push((channel, payload)), None);
        assert_eq!(client.request(request("fail")).unwrap_err(), "boom");
        assert_eq!(client.request(request("emit")).unwrap(), "emitted");
        let events = events.lock().unwrap();
        assert_eq!(events[0].0, "execution:status_changed");
        assert_eq!(events[0].1["status"], "RUNNING");
    }

    #[test]
    fn a_timeout_frees_the_caller_and_later_requests_still_work() {
        let client = fake_core(|_, _| {}, None);
        let error = client.request_with_timeout(request("never"), Duration::from_millis(200)).unwrap_err();
        assert!(error.contains("no respondió a never"), "{error}");
        // A late answer for a timed-out request must not be delivered to the next caller.
        let error = client.request_with_timeout(request("slow"), Duration::from_millis(200)).unwrap_err();
        assert!(error.contains("no respondió"), "{error}");
        assert_eq!(client.request(request("fast")).unwrap(), "fast");
        thread::sleep(Duration::from_millis(1500));
        assert_eq!(client.request(request("fast")).unwrap(), "fast");
    }

    #[test]
    fn a_dead_core_fails_waiting_and_new_requests_quickly() {
        let client = fake_core(|_, _| {}, None);
        let waiting_client = client.clone();
        let waiting = thread::spawn(move || waiting_client.request(request("never")));
        thread::sleep(Duration::from_millis(150));
        let started = Instant::now();
        let _ = client.request_with_timeout(request("die"), Duration::from_secs(5));
        let error = waiting.join().unwrap().unwrap_err();
        assert!(error.contains("se detuvo"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(5));
        thread::sleep(Duration::from_millis(100));
        assert!(client.request(request("fast")).unwrap_err().contains("se detuvo"));
    }

    #[test]
    fn a_dead_core_is_restarted_on_the_next_request() {
        let sidecar = RestartingSidecar::new(Box::new(|| {
            let mut command = Command::new("node");
            command.arg("-e").arg(FAKE_CORE);
            SidecarClient::spawn(command, |_, _| {}, None)
        }))
        .unwrap();
        assert_eq!(sidecar.request(request("fast")).unwrap(), "fast");
        assert!(sidecar.request(request("die")).is_err());
        thread::sleep(Duration::from_millis(150));
        assert_eq!(sidecar.request(request("fast")).unwrap(), "fast");
        assert_eq!(sidecar.restarts(), 1);
    }

    #[test]
    fn stderr_is_appended_to_the_log_file() {
        let directory = std::env::temp_dir().join(format!("graphdev2-sidecar-log-{}", std::process::id()));
        let log = directory.join("logs").join("sidecar.log");
        let client = fake_core(|_, _| {}, Some(log.clone()));
        assert_eq!(client.request(request("log")).unwrap(), "logged");
        drop(client);
        thread::sleep(Duration::from_millis(200));
        let content = std::fs::read_to_string(&log).unwrap();
        let _ = std::fs::remove_dir_all(&directory);
        assert!(content.contains("core diagnostic"), "{content}");
    }
}
