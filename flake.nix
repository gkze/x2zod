{
  description = "x2zod";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    systems.url = "github:nix-systems/default";

    bun2nix = {
      url = "github:nix-community/bun2nix/2.1.0";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.systems.follows = "systems";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      bun2nix,
      ...
    }:
    let
      inherit (nixpkgs) lib;

      # The pinned nixpkgs revision no longer supports Intel Darwin.
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      eachSystem = lib.genAttrs supportedSystems;

      bunVersion = "1.3.14";
      bunArchives = {
        "aarch64-darwin" = {
          asset = "bun-darwin-aarch64";
          hash = "sha256-2LliIYKK1vl6x6wKt+lYcjQa92MAHogD6CZ2UsJlJiA=";
        };
        "aarch64-linux" = {
          asset = "bun-linux-aarch64";
          hash = "sha256-on/7Y6gxA3WDbg1vZorhf6jY0YuIw3yCHGUzGXOhmjs=";
        };
        "x86_64-linux" = {
          asset = "bun-linux-x64-baseline";
          hash = "sha256-oGOQiuCLeFLKEJObvcbO7T3avOj7lALc6D1l1zs25sc=";
        };
      };

      mkBun =
        pkgs:
        let
          archive = bunArchives.${pkgs.stdenv.hostPlatform.system};
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "bun";
          version = bunVersion;

          src = pkgs.fetchurl {
            url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${archive.asset}.zip";
            inherit (archive) hash;
          };

          nativeBuildInputs = [
            pkgs.unzip
          ]
          ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.autoPatchelfHook
          ];
          buildInputs = lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];

          unpackPhase = ''
            unzip "$src"
          '';

          installPhase = ''
            install -Dm755 ${archive.asset}/bun "$out/bin/bun"
            ln -s bun "$out/bin/bunx"
          '';

          meta = {
            description = "Incredibly fast JavaScript runtime, bundler, test runner, and package manager";
            homepage = "https://bun.sh";
            license = lib.licenses.mit;
            mainProgram = "bun";
            platforms = builtins.attrNames bunArchives;
          };
        };

      bunOverlay = final: _previous: {
        bun = mkBun final;
      };

      nodeVersion = "24.18.0";
      nodeArchives = {
        "aarch64-darwin" = {
          platform = "darwin-arm64";
          hash = "sha256-4al+FMmcgD6WxzOUAyguoFpJnDL42D3v6e9exm+XntE=";
        };
        "aarch64-linux" = {
          platform = "linux-arm64";
          hash = "sha256-a0SEwhkCdBdd+aqPKOLXWKgZyxwf5qtIHi+VtGOrhQg=";
        };
        "x86_64-linux" = {
          platform = "linux-x64";
          hash = "sha256-eDEwmElj23upy9AQierywu+wVcfBaTyUMXS5Z7MFDLg=";
        };
      };

      mkNode =
        pkgs:
        let
          archive = nodeArchives.${pkgs.stdenv.hostPlatform.system};
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "nodejs";
          version = nodeVersion;

          src = pkgs.fetchurl {
            url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-${archive.platform}.tar.gz";
            inherit (archive) hash;
          };

          nativeBuildInputs = lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            pkgs.autoPatchelfHook
          ];
          buildInputs = lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.stdenv.cc.cc.lib ];

          dontBuild = true;

          installPhase = ''
            mkdir -p "$out"
            cp -R . "$out"
          '';

          meta = {
            description = "JavaScript runtime built on Chrome's V8 JavaScript engine";
            homepage = "https://nodejs.org";
            license = lib.licenses.mit;
            mainProgram = "node";
            platforms = builtins.attrNames nodeArchives;
          };
        };

      nodeOverlay = final: _previous: {
        nodejs_24 = mkNode final;
      };

      pkgsFor = eachSystem (
        system:
        import nixpkgs {
          inherit system;
          overlays = [
            bun2nix.overlays.default
            bunOverlay
            nodeOverlay
          ];
        }
      );

      packageJson = builtins.fromJSON (builtins.readFile ./package.json);

      mkX2zod =
        pkgs:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "x2zod";
          inherit (packageJson) version;

          src = lib.cleanSourceWith {
            src = ./.;
            filter =
              path: type:
              (lib.cleanSourceFilter path type)
              && !builtins.elem (baseNameOf path) [
                ".direnv"
                ".turbo"
                "coverage"
                "dist"
                "node_modules"
              ];
          };

          nativeBuildInputs = with pkgs; [
            actionlint
            bun
            deadnix
            pkgs.bun2nix.hook
            makeWrapper
            nixfmt
            nodejs_24
            shellcheck
            statix
          ];

          bunDeps = pkgs.bun2nix.fetchBunDeps {
            bunNix = ./bun.nix;
          };

          dontConfigure = true;
          dontBuild = true;
          doCheck = true;

          env = {
            TURBO_TELEMETRY_DISABLED = "1";
            ACTIONLINT_BIN = lib.getExe pkgs.actionlint;
            SHELLCHECK_BINARY = lib.getExe pkgs.shellcheck;
            X2ZOD_NODE_BINARY = lib.getExe pkgs.nodejs_24;
          };

          checkPhase = ''
            runHook preCheck
            export HOME="$TMPDIR"
            bun --no-env-file run check
            runHook postCheck
          '';

          installPhase = ''
            runHook preInstall

            appRoot="$out/lib/x2zod"
            mkdir -p "$appRoot" "$out/bin"

            cp -R \
              .oxfmtrc.json \
              .oxlintrc.jsonc \
              apps \
              bun.lock \
              bunfig.toml \
              node_modules \
              package.json \
              packages \
              tsconfig.json \
              turbo.json \
              "$appRoot"/

            makeWrapper ${lib.getExe pkgs.bun} "$out/bin/x2zod" \
              --chdir "$appRoot" \
              --add-flags "run apps/cli/src/cli.ts"

            runHook postInstall
          '';

          meta = {
            description = "JSON Schema to Zod source generator";
            homepage = "https://github.com/gkze/x2zod";
            mainProgram = "x2zod";
            platforms = lib.platforms.unix;
          };
        };
    in
    {
      packages = eachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
          x2zod = mkX2zod pkgs;
        in
        {
          default = x2zod;
          inherit x2zod;
        }
      );

      apps = eachSystem (system: {
        default = {
          type = "app";
          program = lib.getExe self.packages.${system}.default;
          meta.description = "Run x2zod";
        };
      });

      checks = eachSystem (system: {
        inherit (self.packages.${system}) default;
      });

      devShells = eachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        {
          default = pkgs.mkShell {
            packages =
              (with pkgs; [
                bun
                actionlint
                deadnix
                git
                nil
                nixfmt
                nodejs_24
                shellcheck
                shfmt
                statix
              ])
              ++ [ bun2nix.packages.${system}.bun2nix ];

            ACTIONLINT_BIN = lib.getExe pkgs.actionlint;
            SHELLCHECK_BINARY = lib.getExe pkgs.shellcheck;
            X2ZOD_NODE_BINARY = lib.getExe pkgs.nodejs_24;

            shellHook = ''
              if [ ! -d node_modules ]; then
                bun --no-env-file install --frozen-lockfile
              fi
            '';
          };
        }
      );

      formatter = eachSystem (system: pkgsFor.${system}.nixfmt);
    };
}
