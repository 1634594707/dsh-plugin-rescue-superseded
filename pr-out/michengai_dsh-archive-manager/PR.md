## 症状

- @michengai/dsh-archive-manager@0.1.44 在 dsh 0.1.7-rc.2 下**被预检拦下**(peer 判定:blocked)。
  - @deepseek-ai/dsh-client-connection 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-client-locale 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-client-runtime 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 未装
  - @deepseek-ai/dsh-client-store 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-client-ui-conversation 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-client-ui-primitives 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-client-ui-sidebar 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-client-ui-workspace 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-host-webserver 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-session 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-session-projection-cache 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-spill-local 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-storage-domain 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-typert-protocol 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-typert-registry 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
  - @deepseek-ai/dsh-workspace 要 0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2,已装 0.1.7-rc.2
- 对照目标版本 0.2.0-rc.1 做了公开面 diff。

## 诊断

- 它 import 的具名符号在 0.2.0-rc.1 的公开面里**都还在**(@deepseek-ai/dsh-session-projection-cache 6→6, @deepseek-ai/dsh-spill-local 9→10, @deepseek-ai/dsh-storage-domain 9→10, @deepseek-ai/dsh-typert-protocol 13→13, @deepseek-ai/dsh-workspace 17→17),所以这不是 API 变更,是 peer 范围过窄。

## 建议改动

```diff
建议:@deepseek-ai/dsh-client-connection  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-client-locale  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-client-runtime  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-client-store  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-client-ui-conversation  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-client-ui-primitives  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-client-ui-sidebar  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-client-ui-workspace  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-host-webserver  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-session  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-session-projection-cache  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-spill-local  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-storage-domain  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-typert-protocol  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-typert-registry  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0
建议:@deepseek-ai/dsh-workspace  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2  →  0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0

@@ -39,5 +39,5 @@
    "peerDependencies": {
      "@deepseek-ai/cordis": "^4.0.1",
-     "@deepseek-ai/dsh-client-connection": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-client-connection": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-client-locale": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -40,5 +40,5 @@
      "@deepseek-ai/cordis": "^4.0.1",
      "@deepseek-ai/dsh-client-connection": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-client-locale": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-client-locale": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-store": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -41,5 +41,5 @@
      "@deepseek-ai/dsh-client-connection": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-locale": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-client-store": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-ui-conversation": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -42,5 +42,5 @@
      "@deepseek-ai/dsh-client-locale": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-client-store": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-client-store": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-client-ui-conversation": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -43,5 +43,5 @@
      "@deepseek-ai/dsh-client-runtime": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-store": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-client-ui-conversation": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-client-ui-conversation": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-ui-sidebar": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -44,5 +44,5 @@
      "@deepseek-ai/dsh-client-store": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-ui-conversation": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-client-ui-sidebar": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-ui-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -45,5 +45,5 @@
      "@deepseek-ai/dsh-client-ui-conversation": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-client-ui-sidebar": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-client-ui-sidebar": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-client-ui-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-host-webserver": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -46,5 +46,5 @@
      "@deepseek-ai/dsh-client-ui-primitives": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-ui-sidebar": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-client-ui-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-client-ui-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-host-webserver": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-session": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -47,5 +47,5 @@
      "@deepseek-ai/dsh-client-ui-sidebar": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-client-ui-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-host-webserver": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-host-webserver": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-session": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-session-projection-cache": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -48,5 +48,5 @@
      "@deepseek-ai/dsh-client-ui-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-host-webserver": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-session": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-session": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-session-projection-cache": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-spill-local": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -49,5 +49,5 @@
      "@deepseek-ai/dsh-host-webserver": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-session": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-session-projection-cache": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-session-projection-cache": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-spill-local": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-storage-domain": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -50,5 +50,5 @@
      "@deepseek-ai/dsh-session": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-session-projection-cache": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-spill-local": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-spill-local": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-storage-domain": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-typert-protocol": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -51,5 +51,5 @@
      "@deepseek-ai/dsh-session-projection-cache": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-spill-local": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-storage-domain": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-storage-domain": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-typert-protocol": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-typert-registry": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
@@ -52,5 +52,5 @@
      "@deepseek-ai/dsh-spill-local": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-storage-domain": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-typert-protocol": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-typert-protocol": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-typert-registry": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2"
@@ -53,5 +53,5 @@
      "@deepseek-ai/dsh-storage-domain": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-typert-protocol": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-typert-registry": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
+     "@deepseek-ai/dsh-typert-registry": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0",
      "@deepseek-ai/dsh-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2"
    },
@@ -54,5 +54,5 @@
      "@deepseek-ai/dsh-typert-protocol": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
      "@deepseek-ai/dsh-typert-registry": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2",
-     "@deepseek-ai/dsh-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2"
+     "@deepseek-ai/dsh-workspace": "0.1.0-rc.8 || 0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.5-rc.1 || 0.1.5-rc.2 || 0.1.6-alpha.1 || 0.1.6-alpha.2 || >=0.2.0-0 <0.3.0"
    },
    "peerDependenciesMeta": {
```

## 怎么复现与验证

```sh
dsh-rescue doctor --profile <你的 profile>
dsh-rescue why @michengai/dsh-archive-manager --to 0.2.0-rc.1 --json
```

(工具尚未发布到 npm;仓库内用 `node lib/cli.js …` 代替 `dsh-rescue …`。)

附件:diagnostic.json, peer-dependencies.diff(其中 `diagnostic.json` 是 rescue.diagnostic/v1)

生成:2026-09-29T06:38:35.746Z
