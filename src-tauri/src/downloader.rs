use anyhow::{anyhow, Context, Result};
use reqwest::{header::RANGE, Client, StatusCode};
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy)]
pub struct ModelFileDescriptor {
    pub url: &'static str,
    pub name: &'static str,
}

const MAX_STREAM_RETRIES: usize = 4;
const DOWNLOAD_REQUEST_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 24);
const RETRY_BACKOFF_BASE_MS: u64 = 300;

fn can_retry(retries: &mut usize) -> bool {
    *retries = retries.saturating_add(1);
    *retries <= MAX_STREAM_RETRIES
}

async fn wait_before_retry(retries: usize) {
    let delay_ms = RETRY_BACKOFF_BASE_MS.saturating_mul(retries as u64);
    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
}

#[derive(Serialize, Clone)]
struct DownloadProgressPayload {
    model: String,
    file: String,
    downloaded: u64,
    total: u64,
    percent: f64,
}

#[derive(Serialize, Clone)]
struct DownloadCompletePayload {
    model: String,
}

#[derive(Serialize, Clone)]
struct DownloadErrorPayload {
    model: String,
    error: String,
}

pub async fn download_file<R: Runtime>(
    app: &AppHandle<R>,
    client: &Client,
    url: &str,
    file_name: &str,
    model_name: &str,
    target_dir: &Path,
    cancel_token: &CancellationToken,
) -> Result<()> {
    let target_path = target_dir.join(file_name);
    let mut downloaded = std::fs::metadata(&target_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let mut total_size: u64 = 0;
    let mut retries: usize = 0;
    let mut resume_supported = true;

    loop {
        if cancel_token.is_cancelled() {
            let _ = std::fs::remove_file(&target_path);
            return Err(anyhow!("Download cancelled"));
        }

        if !resume_supported && downloaded > 0 {
            downloaded = 0;
            total_size = 0;
            let _ = std::fs::remove_file(&target_path);
        }

        let mut request = client.get(url).timeout(DOWNLOAD_REQUEST_TIMEOUT);
        if resume_supported && downloaded > 0 {
            request = request.header(RANGE, format!("bytes={downloaded}-"));
        }

        let send_future = request.send();
        tokio::pin!(send_future);

        let mut res = tokio::select! {
            _ = cancel_token.cancelled() => {
                let _ = std::fs::remove_file(&target_path);
                return Err(anyhow!("Download cancelled"));
            }
            response = &mut send_future => {
                match response {
                    Ok(response) => response,
                    Err(err) => {
                        if !can_retry(&mut retries) {
                            return Err(anyhow!(
                                "Network error while downloading {file_name}. Check your connection and retry."
                            )
                            .context(err));
                        }
                        eprintln!(
                            "[downloader] request failed for {file_name}, retry {retries}/{MAX_STREAM_RETRIES}: {err:?}"
                        );
                        wait_before_retry(retries).await;
                        continue;
                    }
                }
            }
        };

        if resume_supported && downloaded > 0 && res.status() == StatusCode::OK {
            downloaded = 0;
            total_size = 0;
            let _ = std::fs::remove_file(&target_path);
            resume_supported = false;
            eprintln!(
                "[downloader] server does not support range requests for {file_name}; falling back to full restart retries"
            );
            continue;
        }

        if !res.status().is_success() {
            if resume_supported
                && downloaded > 0
                && res.status() == StatusCode::RANGE_NOT_SATISFIABLE
            {
                downloaded = 0;
                total_size = 0;
                let _ = std::fs::remove_file(&target_path);
                resume_supported = false;
                eprintln!(
                    "[downloader] range request not satisfiable for {file_name}; falling back to full restart retries"
                );
                continue;
            }

            if res.status().is_server_error() || res.status() == StatusCode::TOO_MANY_REQUESTS {
                if !can_retry(&mut retries) {
                    return Err(anyhow!(
                        "Download failed with status {} while fetching {file_name}",
                        res.status()
                    ));
                }
                eprintln!(
                    "[downloader] retryable status {} for {file_name}, retry {retries}/{MAX_STREAM_RETRIES}",
                    res.status()
                );
                wait_before_retry(retries).await;
                continue;
            }

            return Err(anyhow!("Download failed with status: {}", res.status()));
        }

        let response_size = res.content_length().unwrap_or(0);
        if response_size > 0 {
            total_size = if downloaded > 0 {
                downloaded.saturating_add(response_size)
            } else {
                response_size
            };
        }

        let mut file = if downloaded > 0 {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&target_path)
                .context("Failed to open partial file")?
        } else {
            File::create(&target_path).context("Failed to create file")?
        };

        let stream_result: Result<()> = loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    drop(file);
                    let _ = std::fs::remove_file(&target_path);
                    break Err(anyhow!("Download cancelled"));
                }
                chunk_result = res.chunk() => {
                    match chunk_result {
                        Ok(Some(chunk)) => {
                            file.write_all(&chunk).context("Failed to write to file")?;
                            downloaded += chunk.len() as u64;

                            let percent = if total_size > 0 {
                                (downloaded as f64 / total_size as f64) * 100.0
                            } else {
                                0.0
                            };

                            app.emit(
                                "download:progress",
                                DownloadProgressPayload {
                                    model: model_name.to_string(),
                                    file: file_name.to_string(),
                                    downloaded,
                                    total: total_size,
                                    percent,
                                },
                            )?;
                        }
                        Ok(None) => {
                            if total_size > 0 && downloaded < total_size {
                                break Err(anyhow!(
                                    "Download ended early ({downloaded}/{total_size} bytes)"
                                ));
                            }
                            break Ok(());
                        }
                        Err(err) => break Err(anyhow!(err).context("Network stream interrupted")),
                    }
                }
            }
        };

        match stream_result {
            Ok(()) => return Ok(()),
            Err(err) => {
                if cancel_token.is_cancelled() {
                    let _ = std::fs::remove_file(&target_path);
                    return Err(anyhow!("Download cancelled"));
                }
                if !can_retry(&mut retries) {
                    eprintln!(
                        "[downloader] stream interrupted for {file_name} after {retries} retries: {err:?}"
                    );
                    return Err(anyhow!(
                        "Network interrupted while downloading {file_name}. Check your connection and retry."
                    ));
                }
                eprintln!(
                    "[downloader] stream retry for {file_name}, retry {retries}/{MAX_STREAM_RETRIES}: {err:?}"
                );
                wait_before_retry(retries).await;
            }
        }
    }
}

pub async fn download_model_files<R: Runtime>(
    app: &AppHandle<R>,
    client: &Client,
    model: &str,
    files: &[ModelFileDescriptor],
    target_dir: &Path,
    cancel_token: &CancellationToken,
) -> Result<()> {
    if !target_dir.exists() {
        std::fs::create_dir_all(target_dir).context("Failed to create model directory")?;
    }

    for descriptor in files {
        if cancel_token.is_cancelled() {
            return Err(anyhow!("Download cancelled"));
        }

        if let Err(err) = download_file(
            app,
            client,
            descriptor.url,
            descriptor.name,
            model,
            target_dir,
            cancel_token,
        )
        .await
        {
            let _ = app.emit(
                "download:error",
                DownloadErrorPayload {
                    model: model.to_string(),
                    error: err.to_string(),
                },
            );
            return Err(err);
        }
    }

    let _ = app.emit(
        "download:complete",
        DownloadCompletePayload {
            model: model.to_string(),
        },
    );
    Ok(())
}
