# Personal data

No personal data stands in this repository's unit: not a person's name, handle or account id, not a
mail address, telephone number, home path under a person's account, host name, domain, device or
private network address, and not a line of an actual note. None of them stands in code, a comment, a
document, a test fixture or a commit message in `src/`, `client/`, `deploy/`, `docs/`, `tests/`, the
README, the licence or the root manifests.

## What to write instead

- **A value belongs to the installation that holds it.** An address, a host, a path, a port and a
  credential are read from a settings file or the environment; the code that reads one never carries
  its value.
- **An example is neutral and takes no such form.** A person is `tester`, an account is a small number
  such as `2`, a note title is written for the test (`Groceries`, `Standup`). A sample mail address,
  telephone number, home path or token is not written at all, even with a made-up value.
- **A credential is never committed.** A token, a key and a password are configuration; one that has
  leaked is replaced and is not quoted in a document, a test or a commit message.

## The values the repository allows

None. No name, address, path or credential is admitted as an exception; what differs by person, host or
deployment is configuration its consumer passes in.

## The check

`tests/repository.rs` reads the unit's own tracked or new text files, line by line, and fails where it
finds a mail address, a home path, a telephone number, a token or a private network address. It reports
the file, the line and the kind, never the value it found. Files git ignores, such as the build output
and the client's vendor copy, are not read, and neither are the fork's upstream folders.
