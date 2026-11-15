//! Stands in for the ctrlc crate, which stvtf's CLI uses and which has nothing to hook in a
//! browser. Only what stvtf calls is here.

/// Never returned: there are no signals to listen for.
#[derive(Debug)]
pub struct Error;

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("no signals here")
    }
}

impl std::error::Error for Error {}

/// Does nothing.
pub fn set_handler<F: FnMut() + 'static + Send>(_handler: F) -> Result<(), Error> {
    Ok(())
}
