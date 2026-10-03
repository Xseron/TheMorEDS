# Mör

Слой юридической идентичности для Solana: программы, токены и кошельки компаний
подтверждаются государственной электронной подписью. Для eIDAS подпись удостоверяющего
центра над сертификатом проверяется в сети без посредника — её проверяет прекомпайл
secp256r1 прямо в транзакции. Список доверенных УЦ при этом ведёт администратор
программы (он же upgrade authority). Для НУЦ РК (ГОСТ 34.10-2015) — через аттестатор,
потому что ГОСТ и Стрибога в Solana нет.

Проект для Colosseum Crypto World's Fair 2026.

## Состояние (неделя 2)

- `programs/mor-registry` — реестр:
  - `TrustService` — УЦ из доверенного списка (P-256, eIDAS) или аттестатор (Ed25519, НУЦ РК);
  - `Certificate` — сертификат юридического лица; `register_certificate` проверяет подпись УЦ
    через прекомпайл P-256 и Instructions sysvar, отклоняет сертификаты УЦ, физлиц, TLS-серверов,
    меток времени и OCSP;
  - `Seal` — печать адреса (кошелёк, программа, минт): кто стоит за адресом, юрисдикция, уровень
    доверия, срок. Двустороннее согласие: организация подписывает сообщение печати
    (`register_seal_p256` — ключом сертификата, уровень `Trustless`; `register_seal_attested` —
    через аттестатора, уровень `Attestor`), контролёр адреса подписывает транзакцию.
    `revoke_seal` — отзыв сохранённым или текущим контролёром.
- `crates/mor-verify-seal` — проверка печати из любой программы одной строкой.
- `programs/sealed-transfer` — демо: токен Token-2022 с transfer hook, переводы проходят только
  владельцу с действующей печатью.
- Персональные данные подписанта в сеть не попадают: для НУЦ РК в открытом виде только название
  организации, БИН — хэшем с солью (`sha256(соль ‖ KZ ‖ БИН)`); соль остаётся у владельца.
- `fixtures/` — тестовый УЦ, сертификаты, ключ аттестатора (`gen.sh`); ключи в `fixtures/keys/` —
  только для тестов.
- Program ID (devnet): см. `Anchor.toml`.

## Проверка печати в своей программе

    let seal = mor_verify_seal::verify_seal(&seal_account, &owner, TrustLevel::Attestor)?;
    // seal.jurisdiction, seal.trust_level, seal.identifier_hash, seal.expires_at

`seal_account` — PDA `["seal", owner]` программы реестра. Ошибки — `Custom(9100..9103)`: нет
печати, чужой аккаунт, срок истёк, уровень ниже нужного.

## Что нужно

- WSL Ubuntu: сборка и тесты запускаются из WSL.
- Solana CLI 3.1.10 — её требует Anchor 1.1.2 для сборки программ.
- Anchor 1.1.2.
- Node.js ≥ 20.11 — для `scripts/devnet-v1`.

## Сборка и тесты

    anchor build
    cargo test -p mor_registry -p sealed_transfer -p mor-verify-seal

`anchor build` — обязательно перед `cargo test`: LiteSVM-тесты загружают собранные
`target/deploy/*.so`.

## Аттестатор НУЦ РК (`attestor/`)

Локальный Go-сервис. Компания подписывает в NCALayer запрос на печать (CAdES, ключ ГОСТ 2015
НУЦ РК); аттестатор проверяет подпись через KalkanCrypt — сертифицированное СКЗИ НУЦ — и, если
подписал первый руководитель или сотрудник с правом подписи, подписывает Ed25519-ключом
сообщение печати для `register_seal_attested`.

- Подпись, цепочку до УЦ НУЦ и отзыв по CRL проверяет только KalkanCrypt (cgo). Поля
  сертификата (O, `OU=BIN…`, роль в EKU, срок) читает `crypto/x509` — разбор без криптографии.
- В сеть попадают название организации и `sha256(соль ‖ KZ ‖ БИН)`; соль и БИН аттестатор
  отдаёт только запросившему и не хранит. ФИО и ИИН он не читает и не пишет в лог.
- Ключ `fixtures/keys/attestor.json` и тестовый УЦ НУЦ — только для devnet: ключ лежит в
  репозитории, и печать уровня «аттестатор» им может поставить кто угодно.

Код возврата `VerifyData` в KalkanCrypt не отражает значение подписи ГОСТ, поэтому вердикт
аттестатор берёт из собственного отчёта библиотеки о проверке (`outVerifyInfo`: по каждому
подписанту ровно «Verify - OK», иначе отказ), а цепочку и отзыв дополнительно проверяет
`X509ValidateCertificate(KC_USE_CRL)`. После любого обновления KalkanCrypt нужно заново
запустить `go test -tags kalkan ./...`: изменившийся текст отчёта отклонит любую CMS.

Нужно: Go 1.24, gcc, `sudo apt install libltdl7 libpcsclite1` и SDK НУЦ РК (KalkanCrypt,
тестовые ключи и УЦ; выдаёт НУЦ РК, pki.gov.kz) в каталоге `pkisdk/` — в репозиторий он не
входит по лицензии НУЦ. KalkanCrypt берёт доверенные корни только из системного хранилища
(в WSL — `/etc/ssl/certs`): тестовые корни ставятся скриптом SDK
`unzip -d /tmp pkisdk/C/Linux/ca-certs/ca-certs_new/test2022.zip && cd /tmp/test2022 && sudo bash install_test.sh`
(архив распаковывается в `/tmp`, чтобы ничего из SDK не попало в репозиторий). `install_test.sh`
делает так, что весь дистрибутив WSL доверяет тестовым корням НУЦ.
Файлы `--ca` всё равно нужны: они фиксируют издателя (AuthorityKeyId и DN).

Эксплуатация: если тестовых корней нет в системном хранилище, каждый запрос получает 401
`bad_signature`. Файл CRL нужно обновить до его nextUpdate (у тестового CRL это 2027-02-07):
просроченный CRL KalkanCrypt отвергает, и каждый запрос получает 500.

    cd attestor
    go test ./...                 # без SDK: запрос, политика, сообщение печати
    go test -tags kalkan ./...    # с SDK: тестовые ключи НУЦ через KalkanCrypt
    go build -tags kalkan -o bin/attestor ./cmd/attestor
    cd .. && attestor/bin/attestor serve        # http://127.0.0.1:8787

`POST /v1/attest`, тело `{"cms": "<base64>"}` — присоединённая CMS над текстом (UTF-8, LF, без
перевода строки в конце):

    MOR-SEAL-REQUEST-V1
    program: <program ID реестра>
    address: <адрес>
    kind: wallet | program | mint
    controller: <контролёр адреса>
    expires: <unix>
    deadline: <unix, не позже чем через 15 минут>

Ответ — сообщение печати и подпись аттестатора, название, БИН и соль. Ошибки —
`{"error": "<код>"}`: `bad_signature`, `revoked`, `role_not_allowed`, `deadline_out_of_window`
и другие (полный список — в `docs/superpowers/specs/2026-10-02-mor-attestor-design.md`).
`GET /v1/info` — ключ аттестатора и его TrustService.

Флаги `serve`: `--listen`, `--key`, `--ca` и `--crl` (повторяемые; по умолчанию тестовые УЦ и
CRL НУЦ из `pkisdk/`), `--program`, `--cors-origin`, `--kalkan-lib` (или `KALKAN_LIB`; по
умолчанию сертифицированная KalkanCrypt 2.0.2 из SDK). Без NCALayer запрос подписывает
dev-команда: `attestor/bin/attestor sign-request --p12 <ключ.p12> --password <пароль> --request <файл>`.

## Сайт (`web/frontend/`)

Nuxt 4, pnpm. Лендинг и демо: выписка «кто стоит за адресом», печать кошелька, перевод демо-токена.

    cd web/frontend
    pnpm install
    pnpm dev                                  # http://localhost:3000

Печать через НУЦ РК требует NCALayer на машине пользователя и аттестатора рядом:

    attestor/bin/attestor serve --cors-origin http://localhost:3000

Без них работает «Test attestor (demo)»: страница подписывает сообщение тестовым ключом из `fixtures/keys/attestor.json`.

Настройки через переменные `NUXT_PUBLIC_RPC_URL`, `NUXT_PUBLIC_ATTESTOR_URL`, `NUXT_PUBLIC_SITE_URL` (адрес сайта для карточки ссылки и sitemap). Статическая сборка: `pnpm generate` → `.output/public`; страницы `/address/*` строятся в браузере, поэтому хостингу нужен fallback на `200.html`.

Тесты: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright против devnet; e2e-кошелёк из `test/e2e/fixtures/wallet.json` нужно один раз пополнить, адрес печатает `node test/e2e/fixtures/address.mjs`), `pnpm check:build` после `pnpm generate`.

### Корпоративные действия по облигации (`/kase`)

Side track KASE: корпоративные действия по токенизированной облигации на Solana devnet (выпуск, купон, погашение). Программа живёт в отдельном репозитории `mor-kase`: devnet-программа `37kyWEQCrscGU8dxhHPGpbxocH4azaZpc4FNip3zEqEv`, эталонная облигация (mint) `95JPAUBgwwA1fhyeH1BQfrEwvSrfrfU9RU1quP2iCCQc`. Денежная нога имитируется: `tKZT` (mint `Qukc9v9Wgwuzaa5gLtoh9n2P3o72fXcofLWVk5SVGJH`) это тестовый токен из крана программы.

Адреса задаются переменными `NUXT_PUBLIC_BOND_PROGRAM`, `NUXT_PUBLIC_TKZT_MINT`, `NUXT_PUBLIC_KASE_REFERENCE_MINT`.

Демо-инвесторы (`kase-investor-1…3`) хранят ключи в `localStorage` браузера; им нужен SOL от подключённого кошелька. Выпуск требует двух подтверждений в кошельке.

Клиент программы сгенерирован и лежит в `app/utils/bond/generated`. Обновить его:

    (cd ../../../mor-kase/clients/js && npm run generate)
    rm -rf app/utils/bond/generated && cp -r ../../../mor-kase/clients/js/src/generated app/utils/bond/generated

`@solana/program-client-core` указан прямой зависимостью, потому что его импортирует сгенерированный код.

E2E для `/kase`: `E2E_PORT=3100 pnpm test:e2e kase.spec.ts` (переменная порта нужна, чтобы не подхватить dev-сервер из другого чекаута). Полному жизненному циклу нужно не меньше 0,6 SOL на e2e-кошельке.

## Devnet

    cd scripts/devnet-v1 && npm install
    npm run devnet        # УЦ и сертификат Acme (v1-транзакция)
    npm run devnet:seal   # аттестатор, печати, токен с хуком, переводы, отзыв
    npm run devnet:attest -- request              # демо-кошелёк D и текст запроса
    npm run devnet:attest -- submit <ответ.json>  # печать D по ответу аттестатора, перевод токена на D

Между `request` и `submit` запрос подписывается ключом юрлица (NCALayer или `attestor/bin/attestor sign-request`) и отправляется в `POST /v1/attest`; ответ сохраняется в файл — в нём соль, её хранит владелец D.

Адреса программ берутся из `PROGRAM_ID` / `HOOK_ID` (по умолчанию — из `Anchor.toml`). До отправки
скрипт проверяет, что сертификат — печать юрлица без персональных данных. Демо-кошельки
создаются в `~/.config/solana/mor-demo/`.

## Ограничения

- Отозвать печать может только контролёр адреса, не организация (роадмап).
- Программу с upgrade authority в мультисиге и программу или минт без authority запечатать нельзя.
- Смена владельца программы или минта не снимает печать сама: её отзывает новый контролёр.
- Аттестатор проверяет отзыв сертификата НУЦ по CRL в момент печати; печать, поставленную до отзыва, отзыв сертификата не снимает (роадмап). OCSP не используется. Для eIDAS OCSP/CRL не проверяются; печать действует до `expires_at` (для eIDAS — не позже конца сертификата, для аттестатора — не позже конца сертификата подписанта).

## Дальше

Неделя 3: страница «кто стоит за адресом» и запечатывание через NCALayer в браузере.
Роадмап: отзыв печати организацией, CAdES для eIDAS, физлица и ИП, OCSP/CRL.
