# Local Linux reproduction only. Codex Cloud uses install.sh and its start skill.
FROM node:22-bookworm

ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /workspace/ticketry
COPY . .
RUN bash scripts/codex-cloud/install.sh

CMD ["bash"]
