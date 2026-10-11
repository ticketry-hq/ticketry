# Local Linux reproduction only. Codex Cloud uses install.sh and its start skill.
FROM node:22-bookworm
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun

ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace/ticketry
COPY . .
RUN bash scripts/codex-cloud/install.sh

CMD ["bash"]
