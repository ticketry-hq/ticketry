mod bridge;
mod cli;
mod protocol;
mod spool;
mod transport;

use std::io;

fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let hook_mode = arguments.first().is_some_and(|argument| argument == "hook");
    match cli::parse(arguments) {
        Ok(cli::Invocation::Help) => print!("{}", cli::HELP),
        Ok(cli::Invocation::Hook(invocation)) => {
            let _ = spool::run(&invocation, io::stdin().lock());
        }
        Ok(cli::Invocation::Mcp(invocation)) => {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("create async runtime");
            if let Err(error) = runtime.block_on(bridge::run(invocation)) {
                eprintln!("ticketry-hook mcp stopped: {error}");
                std::process::exit(1);
            }
        }
        Err(_) if hook_mode => {}
        Err(error) => {
            eprintln!("ticketry-hook: {error}");
            std::process::exit(2);
        }
    }
}
