{
  description = "x2zod";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    systems.url = "github:nix-systems/default";

    bun2nix = {
      url = "github:nix-community/bun2nix/2.0.8";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.systems.follows = "systems";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      systems,
      bun2nix,
      ...
    }:
    let
      inherit (nixpkgs) lib;

      eachSystem = lib.genAttrs (import systems);

      pkgsFor = eachSystem (
        system:
        import nixpkgs {
          inherit system;
          overlays = [ bun2nix.overlays.default ];
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
            pkgs.bun2nix.hook
            makeWrapper
            nodejs_25
            shellcheck
          ];

          bunDeps = pkgs.bun2nix.fetchBunDeps {
            bunNix = ./bun.nix;
          };

          dontConfigure = true;
          dontBuild = true;
          doCheck = true;

          env.TURBO_TELEMETRY_DISABLED = "1";
          env.ACTIONLINT_BIN = lib.getExe pkgs.actionlint;
          env.SHELLCHECK_BINARY = lib.getExe pkgs.shellcheck;

          checkPhase = ''
            runHook preCheck
            export HOME="$TMPDIR"
            bun run check
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
        default = self.packages.${system}.default;
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
                nodejs_25
                shellcheck
                shfmt
                statix
              ])
              ++ [ bun2nix.packages.${system}.bun2nix ];

            ACTIONLINT_BIN = lib.getExe pkgs.actionlint;

            shellHook = ''
              if [ ! -d node_modules ]; then
                bun install --frozen-lockfile
              fi
            '';
          };
        }
      );

      formatter = eachSystem (system: pkgsFor.${system}.nixfmt);
    };
}
