# ALPHA GRAVITY 大型アップデート ロードマップ

このファイルは作業の中断・再開のための進捗管理ドキュメント。
各タスク完了時に `[ ]` → `[x]` に更新し、`## 現在地` を書き換える。
セッションが切れたら、まずこのファイルと `src/game/types.ts` の APP_VERSION を確認する。

## 現在地
- 開始時点バージョン: v6（アルファベット/画像/図形モード + 正解発表演出まで完成）
- 完了: W1(v7), W2(v8), W3(v9), W4(v10), W5(v11), W6 探索トレイル（v12）
- 全ウェーブ完了 + フィードバック対応（v13）
- v13修正: トレイル視認性UP(黄・大・depthTest off)/接続音を「カチッ！」スイッチ化/足音を硬いタイル音に/全体音量UP/メニューUIの重なり修正/**ハードの図形を扇状分割→まっすぐな辺の固有ピースに全面刷新**(家/えんぴつ/タワー/宝石/手紙/山/矢印/ロボット/船、同形は最大2つ)

## ビルド/検証コマンド
```
cd /home/claude/alphabet-gravity-game
npx tsc --noEmit                 # 型チェック
npm run lint                     # lint（error/warning 0 を維持）
npx esbuild src/game/shapes.ts --bundle --format=cjs --outfile=/tmp/shapes.cjs && node /tmp/test_shapes.cjs  # 図形エンジンのユニットテスト
npm run build:single             # dist/alphabet-gravity-game_v6.html を生成
```
出力: `/mnt/user-data/outputs/alphabet-gravity-game_vN.html` に最新、1つ前を残す。zip も更新。

## 設計方針（ユーザー合意事項）
- コアピラー: 「乗っているせいで全体が見えない巨大物体を、地表探索で頭の中で再構築して当てる」。芯を縦に掘る。
- 目的: **就活ポートフォリオ（設計力を見せる完成品）**。1つの柱を tight に磨く方向。
- ユーザー要望の温度感: 2オーディオ/演出が最重要（「こだわって」）、次いで1ランキング、4コンテンツ量。

---

## W1: 基盤（設定・快適性・スコア） → v7 ✅完了
- [x] `settings.ts`: localStorage 永続化。FOV / マウス感度 / Y反転 / 重力再配向スムージング / 音量・ミュート
- [x] 設定UIパネル（メニューの歯車 + ゲーム中も歯車で開ける）
- [x] Player に感度・スムージング・Y反転を反映
- [x] カメラFOVを Player 側で毎フレーム設定に追従（applyFov ヘルパ）
- [x] 快適性: 再配向スムージング可変化（settings.reorientSmooth）
- [x] `score.ts`: RoundStats + computeSoloScore/computeEndlessScore（時間・ワープ・ミス・歩行距離）
- [x] Player(歩行距離) / ShapeStage(warps,mistakes) / App(timeSec) で統計集計

## W2: コンテンツ増量 + ランダム → v8 ✅完了
- [x] easy +10（プラス/長方形/大正方形/L字/T字/階段/レンガ=正方形合同、ひし形/台形/三角形=正三角形合同）
- [x] hard +10（家/宝石/ダイヤ/矢印/船/テント/クリスタル/盾/五角形/六角ナット=扇状分割で固有ピース）
- [x] ジェネレータ: squareGrid / fanSplit / regPoly / etriSlot（shapes.ts）
- [x] 自動ソルバーテスト（/tmp/autosolve.cjs）で全23パズル solvable 確認。既存42ユニットテストも維持
- [x] 図形モードに「ランダム」選択肢（全図形からランダム、お題シルエット表示）

## W3: エンドレスモード → v9 ✅完了
- [x] エンドレス（アルファベット + 図形。画像は対象外＝トグル自体を非表示）
- [x] 制限時間: 初期持ち時間 + クリア時ボーナス。0でゲームオーバー、クリア数でスコア
- [x] endlessTiming() でモード×バリアント調整（アルファ<図形, easy<hard を保持。誤答ペナルティはアルファのみ）
- [x] エンドHUD（残り時間バー・クリア数・+Ns/-Nsフラッシュ・残り5秒で赤点滅）
- [x] エンドレス結果画面（クリア数）。ランキング連携は W4 で対応

## W4: ランキング → v10 ✅完了
- [x] `leaderboard.ts`: localStorage、部門キー `${gametype}:${mode}:${variant}`、上位10件
- [x] ハイスコア時の名前入力（リザルトに名前入力欄+順位表示、名前はlocalStorage記憶）
- [x] ランキング画面（部門セレクタ: ソロ/エンドレス × モード × サイズ/難易度）
- [x] 1/2/3位を段階的に豪華に（表彰台。中央=1位を最大、金銀銅の装飾・台座の高さ差）
- [x] ソロ=computeSoloScore(点数) / エンドレス=クリア数 の両対応

## W5: オーディオ + パーティクル → v11 ✅ほぼ完了
- [x] `audio.ts`: Web Audio 合成エンジン（ファイル不要）
- [x] 環境音（低音ドローン2本+LFO揺れ+高音きらめき、フェードイン/アウト）
- [x] 足音（移動速度連動、Player）
- [x] 重力再配向音「グッ」（大きく面が変わった瞬間、Player）
- [x] ワープ音 / 面マーク音 / マーク解除音
- [x] 接続成功「カチッ」（二段+倍音）/ 接続失敗ブザー
- [x] 正解ファンファーレ（アルペジオ）/ エンドレス時間追加音 / 残り5秒カウントダウン音
- [x] 正解パーティクル（祝祭バースト、reveal中に土台まわり）
- [x] 接続成功パーティクル（ConnectBurst、接続位置で光の粒が弾ける）
- [x] 音量・ミュート設定と連動（master gain が settings 購読）

## W6: 探索の記憶（トレイル） → v12 ✅完了
- [x] 歩いた軌跡（足元に小さな薄いteal点、最大500点のリングバッファ）
- [x] M キーで表示/非表示トグル（既定ON）
- [x] 非侵襲な見た目（3px固定サイズ・opacity0.32・reveal中は非表示・答えの形は読めない粒度）

---

## 実装メモ（引き継ぎ用）
- 単一HTMLは**ダウンロードして直接開く**運用なので localStorage が使える（Claude.ai の artifact サンドボックス制約は非該当）。
- 図形エンジン（shapes.ts）は純2Dで Node テスト済み。パズル追加時は必ずテストで「解けること」を確認。
- Player はマルチサーフェス吸着。カメラは Player が毎フレーム制御（reveal 時のみ RevealCamera）。
- スケール設計: 文字=×scale, 身長=×scale^0.3, 速度=×sqrt(scale)。図形は一律 SHAPE_SCALE=3。
- 既知のリファクタ注意: react-hooks/purity（render中の Math.random/ref アクセス禁止、effect内の同期setState禁止）。mulberry32 使用。GameScene は key={runId} で毎ラウンド remount。

## スコア計算（W1で確定させる）
ソロ: `score = max(0, round(BASE*variantMult - time*TW - warps*WW - mistakes*MW))`
エンドレス: 到達問題数（主）＋ 残時間/合計時間でタイブレーク
