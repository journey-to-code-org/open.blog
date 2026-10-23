use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub struct ContentTransactionLock(PathBuf);

impl ContentTransactionLock {
    pub fn acquire(root: &Path) -> Result<Self, String> {
        Self::acquire_with_wait(root, Duration::ZERO)
    }

    pub fn acquire_with_wait(root: &Path, max_wait: Duration) -> Result<Self, String> {
        let path = root.join(".openblog").join("content-transaction.lock");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
        }
        let started = Instant::now();
        let mut file = loop {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(file) => break file,
                Err(error)
                    if error.kind() == std::io::ErrorKind::AlreadyExists
                        && started.elapsed() < max_wait =>
                {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    return Err(format!(
                        "another content write is active ({error}). If open.blog crashed and no writer is running, remove {} and retry",
                        path.display()
                    ));
                }
                Err(error) => {
                    return Err(format!("cannot acquire {}: {error}", path.display()));
                }
            }
        };
        writeln!(file, "pid={} action=content-write", std::process::id()).map_err(|error| {
            let _ = fs::remove_file(&path);
            format!(
                "cannot record transaction ownership in {}: {error}",
                path.display()
            )
        })?;
        Ok(Self(path))
    }
}

impl Drop for ContentTransactionLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waiting_writer_acquires_the_lock_after_the_owner_releases_it() {
        let root = std::env::temp_dir().join(format!(
            "ob-content-transaction-wait-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let owner = ContentTransactionLock::acquire(&root).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            drop(owner);
        });

        let next = ContentTransactionLock::acquire_with_wait(&root, Duration::from_secs(1));

        release.join().unwrap();
        drop(next.unwrap());
        let _ = fs::remove_dir_all(root);
    }
}
