# Mör

Юридическая идентичность для Solana: компания подтверждает свои программы, токены и кошельки
государственной электронной подписью

Работает с двумя видами подписи:

- eIDAS (P-256): подпись УЦ над сертификатом проверяет прекомпайл secp256r1 прямо в транзакции,
  без посредника. Список доверенных УЦ ведёт админ программы, он же upgrade authority
- НУЦ РК (ГОСТ 34.10-2015): ГОСТа и Стрибога в Solana нет, поэтому подпись проверяет аттестатор
  вне сети, а в сеть уходит уже его Ed25519-подпись

Проект для Colosseum Crypto World's Fair 2026

## Что есть

- `programs/mor-registry`, реестр. Три типа аккаунтов:
  - `TrustService`: доверенный УЦ (P-256, eIDAS) или аттестатор (Ed25519, НУЦ РК)
  - `Certificate`: сертификат юрлица. `register_certificate` проверяет подпись УЦ через прекомпайл
    P-256 и Instructions sysvar и не пускает сертификаты УЦ, физлиц, TLS-серверов, меток времени
    и OCSP
  - `Seal`: печать адреса (кошелёк, программа или минт). В ней кто стоит за адресом, юрисдикция,
    уровень доверия и срок. Нужны обе стороны: организация подписывает сообщение печати, контролёр
    адреса подписывает транзакцию. `register_seal_p256` ставит печать ключом сертификата (уровень
    `Trustless`), `register_seal_attested` через аттестатора (уровень `Attestor`). Снять печать
    через `revoke_seal` может сохранённый или текущий контролёр
- `crates/mor-verify-seal`: проверка печати из любой программы одной строкой
- `programs/sealed-transfer`: демо-токен Token-2022 с transfer hook, переводы проходят только на
  владельца с действующей печатью
- Персональные данные подписанта в сеть не попадают. Для НУЦ РК в открытом виде лежит только
  название организации, БИН хранится хэшем с солью `sha256(соль || KZ || БИН)`, соль остаётся
  у владельца
- `fixtures/`: тестовый УЦ, сертификаты и ключ аттестатора (`gen.sh`). Ключи в `fixtures/keys/`
  только для тестов
- Program ID на devnet смотрите в `Anchor.toml`

## Проверка печати в своей программе

    let seal = mor_verify_seal::verify_seal(&seal_account, &owner, TrustLevel::Attestor)?;
    // seal.jurisdiction, seal.trust_level, seal.identifier_hash, seal.expires_at

`seal_account` это PDA `["seal", owner]` программы реестра. Ошибки `Custom(9100..9103)`: печати
нет, чужой аккаунт, срок истёк, уровень ниже нужного

## Что нужно

- WSL Ubuntu, сборка и тесты идут из WSL
- Solana CLI 3.1.10, без неё Anchor 1.1.2 не соберёт программы
- Anchor 1.1.2
- Node.js >= 20.11 для `scripts/devnet-v1`

## Сборка и тесты

    anchor build
    cargo test -p mor_registry -p sealed_transfer -p mor-verify-seal

Сначала обязательно `anchor build`: LiteSVM-тесты грузят собранные `target/deploy/*.so`

## Аттестатор НУЦ РК (`attestor/`)

Локальный Go-сервис. Компания подписывает в NCALayer запрос на печать (CAdES, ключ ГОСТ 2015
НУЦ РК). Аттестатор проверяет подпись через KalkanCrypt, сертифицированное СКЗИ НУЦ, и если
подписал первый руководитель или сотрудник с правом подписи, подписывает своим Ed25519-ключом
сообщение печати для `register_seal_attested`

- Подпись, цепочку до УЦ НУЦ и отзыв по CRL проверяет только KalkanCrypt через cgo. Поля
  сертификата (O, `OU=BIN...`, роль в EKU, срок) читает `crypto/x509`, это просто разбор без
  криптографии
- В сеть попадают название организации и `sha256(соль || KZ || БИН)`. Соль и БИН аттестатор
  отдаёт только тому, кто прислал запрос, и нигде не хранит. ФИО и ИИН он не читает и в лог
  не пишет
- Ключ `fixtures/keys/attestor.json` и тестовый УЦ НУЦ годятся только для devnet: ключ лежит
  в репозитории, так что печать уровня "аттестатор" им может поставить кто угодно

Код возврата `VerifyData` в KalkanCrypt ничего не говорит о самой подписи ГОСТ. Поэтому вердикт
берётся из отчёта библиотеки о проверке (`outVerifyInfo`, по каждому подписанту должно быть ровно
"Verify - OK", иначе отказ), а цепочку и отзыв дополнительно проверяет
`X509ValidateCertificate(KC_USE_CRL)`. После обновления KalkanCrypt надо заново прогнать
`go test -tags kalkan ./...`: если текст отчёта поменяется, любая CMS будет отклонена

Нужно: Go 1.24, gcc, `sudo apt install libltdl7 libpcsclite1` и SDK НУЦ РК в `pkisdk/`
(KalkanCrypt, тестовые ключи и УЦ, выдаёт НУЦ РК на pki.gov.kz). SDK в репозиторий не кладём,
лицензия НУЦ этого не разрешает. Доверенные корни KalkanCrypt берёт только из системного
хранилища (в WSL это `/etc/ssl/certs`), тестовые корни ставит скрипт из SDK:

    unzip -d /tmp pkisdk/C/Linux/ca-certs/ca-certs_new/test2022.zip && cd /tmp/test2022 && sudo bash install_test.sh

Распаковываем в `/tmp`, чтобы ничего из SDK не попало в репозиторий. После `install_test.sh`
тестовым корням НУЦ доверяет весь дистрибутив WSL. Файлы `--ca` всё равно нужны, по ним
фиксируется издатель (AuthorityKeyId и DN)

Если тестовых корней в системном хранилище нет, любой запрос получит 401 `bad_signature`. CRL надо
обновлять до его nextUpdate (у тестового CRL это 2027-02-07): просроченный CRL KalkanCrypt
не принимает, и каждый запрос получает 500

    cd attestor
    go test ./...                 # без SDK: запрос, политика, сообщение печати
    go test -tags kalkan ./...    # с SDK: тестовые ключи НУЦ через KalkanCrypt
    go build -tags kalkan -o bin/attestor ./cmd/attestor
    cd .. && attestor/bin/attestor serve        # http://127.0.0.1:8787

`POST /v1/attest` с телом `{"cms": "<base64>"}`, это присоединённая CMS над текстом (UTF-8, LF,
без перевода строки в конце):

    MOR-SEAL-REQUEST-V1
    program: <program ID реестра>
    address: <адрес>
    kind: wallet | program | mint
    controller: <контролёр адреса>
    expires: <unix>
    deadline: <unix, не позже чем через 15 минут>

В ответе сообщение печати, подпись аттестатора, название, БИН и соль. Ошибки приходят как
`{"error": "<код>"}`: `bad_signature`, `revoked`, `role_not_allowed`, `deadline_out_of_window`
и другие, полный список в `attestor/server/server.go` и `attestor/policy/policy.go`.
`GET /v1/info` отдаёт ключ аттестатора и его TrustService

Флаги `serve`: `--listen`, `--key`, `--ca` и `--crl` (можно повторять, по умолчанию тестовые УЦ
и CRL НУЦ из `pkisdk/`), `--program`, `--cors-origin`, `--kalkan-lib` (или `KALKAN_LIB`, по
умолчанию сертифицированная KalkanCrypt 2.0.2 из SDK). Без NCALayer запрос можно подписать
dev-командой: `attestor/bin/attestor sign-request --p12 <ключ.p12> --password <пароль> --request <файл>`

## Сайт (`web/frontend/`)

Nuxt 4, pnpm. Лендинг и демо: выписка "кто стоит за адресом", печать кошелька, перевод демо-токена

    cd web/frontend
    pnpm install
    pnpm dev                                  # http://localhost:3000

Для печати через НУЦ РК нужен NCALayer на машине пользователя и запущенный рядом аттестатор:

    attestor/bin/attestor serve --cors-origin http://localhost:3000

Без них работает "Test attestor (demo)": страница подписывает сообщение тестовым ключом из
`fixtures/keys/attestor.json`

Настраивается переменными `NUXT_PUBLIC_RPC_URL`, `NUXT_PUBLIC_ATTESTOR_URL`,
`NUXT_PUBLIC_SITE_URL` (адрес сайта для превью ссылки и sitemap). Статическая сборка:
`pnpm generate`, результат в `.output/public`. Страницы `/address/*` собираются в браузере,
так что хостингу нужен fallback на `200.html`

Тесты: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright на devnet), `pnpm check:build` после
`pnpm generate`. Для e2e нужен свой кошелёк, в git его нет:

    node -e "console.log(JSON.stringify({seed: require('crypto').randomBytes(32).toString('hex')}))" > test/e2e/fixtures/wallet.json
    node test/e2e/fixtures/address.mjs        # адрес, который надо один раз пополнить

### Корпоративные действия по облигации (`/kase`)

Side track для KASE: корпоративные действия по токенизированной облигации на Solana devnet
(выпуск, купон, погашение). Программа лежит в отдельном репозитории `mor-kase`. Devnet-программа
`37kyWEQCrscGU8dxhHPGpbxocH4azaZpc4FNip3zEqEv`, эталонная облигация (mint)
`95JPAUBgwwA1fhyeH1BQfrEwvSrfrfU9RU1quP2iCCQc`. Денежная нога ненастоящая: `tKZT`
(mint `Qukc9v9Wgwuzaa5gLtoh9n2P3o72fXcofLWVk5SVGJH`) это тестовый токен из крана программы

Адреса задаются переменными `NUXT_PUBLIC_BOND_PROGRAM`, `NUXT_PUBLIC_TKZT_MINT`,
`NUXT_PUBLIC_KASE_REFERENCE_MINT`

Демо-инвесторы (`kase-investor-1...3`) держат ключи в `localStorage` браузера, SOL им переводит
подключённый кошелёк. Выпуск требует двух подтверждений в кошельке

Клиент программы сгенерирован в `app/utils/bond/generated`. Обновить:

    (cd ../../../mor-kase/clients/js && npm run generate)
    rm -rf app/utils/bond/generated && cp -r ../../../mor-kase/clients/js/src/generated app/utils/bond/generated

`@solana/program-client-core` стоит прямой зависимостью, потому что его импортирует
сгенерированный код

E2E для `/kase`: `E2E_PORT=3100 pnpm test:e2e kase.spec.ts`. Порт задаём, чтобы не подхватить
dev-сервер из другого чекаута. На полный жизненный цикл нужно минимум 0,6 SOL на e2e-кошельке

## Devnet

    cd scripts/devnet-v1 && npm install
    npm run devnet        # УЦ и сертификат Acme (v1-транзакция)
    npm run devnet:seal   # аттестатор, печати, токен с хуком, переводы, отзыв
    npm run devnet:attest -- request              # демо-кошелёк D и текст запроса
    npm run devnet:attest -- submit <ответ.json>  # печать D по ответу аттестатора, перевод токена на D

Между `request` и `submit` запрос подписывается ключом юрлица (NCALayer или
`attestor/bin/attestor sign-request`) и уходит в `POST /v1/attest`. Ответ сохраняется в файл,
в нём соль, её хранит владелец D

Адреса программ берутся из `PROGRAM_ID` и `HOOK_ID`, по умолчанию из `Anchor.toml`. Перед
отправкой скрипт проверяет, что сертификат это печать юрлица без персональных данных.
Демо-кошельки создаются в `~/.config/solana/mor-demo/`

## Ограничения

- Отозвать печать может только контролёр адреса, организация пока не может
- Программу с upgrade authority в мультисиге, а также программу или минт без authority
  запечатать нельзя
- Смена владельца программы или минта сама печать не снимает, её отзывает новый контролёр
- Аттестатор проверяет отзыв сертификата НУЦ по CRL в момент печати. Если сертификат отзовут
  позже, печать останется. OCSP не используется, а для eIDAS не проверяются ни OCSP, ни CRL
- Печать действует до `expires_at`, и это не позже конца сертификата (eIDAS) или сертификата
  подписанта (аттестатор)

## Дальше

Отзыв печати организацией, снятие печати при отзыве сертификата, CAdES для eIDAS, физлица и ИП,
OCSP/CRL
