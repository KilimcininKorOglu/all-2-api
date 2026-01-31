#!/bin/bash
# Read the commit message from stdin and translate Chinese to English

sed \
    -e 's/feat(orchids): 添加平台配额用量展示功能/feat(orchids): add platform quota usage display feature/g' \
    -e 's/破甲兰花/feat: add Orchids integration/g' \
    -e 's/兰花注册/feat: add Orchids registration/g' \
    -e 's/fix: KiroService 添加 400 ValidationException 压缩重试/fix: KiroService add 400 ValidationException compression retry/g' \
    -e 's/fix: 修复 balancer.js 路径错误/fix: fix balancer.js path error/g' \
    -e 's/feat: 添加滚动升级脚本/feat: add rolling upgrade script/g' \
    -e 's/feat: 添加 Amazon Bedrock 管理和调用功能/feat: add Amazon Bedrock management and API integration/g' \
    -e 's/feat: 400 错误自动压缩消息上下文重试/feat: auto-compress message context and retry on 400 error/g' \
    -e 's/fix: 优化 Kiro 客户端防止 ValidationException 错误/fix: optimize Kiro client to prevent ValidationException errors/g' \
    -e 's/refactor: Vertex AI 模块改为仅支持 Gemini 模型/refactor: Vertex AI module now only supports Gemini models/g' \
    -e 's/feat: 添加模型定价管理功能/feat: add model pricing management feature/g' \
    -e 's/refactor: 重构项目目录结构，按模块分类整理代码/refactor: restructure project directory by module/g' \
    -e 's/fix: 修复 Antigravity 代理配置和 Gemini 3 Pro thinking 配置/fix: fix Antigravity proxy config and Gemini 3 Pro thinking config/g' \
    -e 's/feat: 添加代理环境变量配置（HTTP_PROXY, HTTPS_PROXY, NO_PROXY）/feat: add proxy environment variable support/g' \
    -e 's/fix: 修复 install_mihomo.sh 脚本/fix: fix install_mihomo.sh script/g' \
    -e 's/feat: 添加 Vertex AI 支持和修复流式请求代理问题/feat: add Vertex AI support and fix streaming request proxy issues/g' \
    -e 's/chore: 移除号池购买链接/chore: remove account pool purchase link/g' \
    -e 's/feat: 添加使用账号邮箱名称的日志打印/feat: add account email name to log output/g' \
    -e 's/fix: 使用 buildCodeWhispererUrl 处理区域映射/fix: use buildCodeWhispererUrl for region mapping/g' \
    -e 's/feat: 修复 us-west-1 区域支持和 Write 工具参数处理/feat: fix us-west-1 region support and Write tool parameter handling/g' \
    -e 's/fix: 修改数据库默认连接地址为本地/fix: change default database connection to localhost/g' \
    -e 's/feat: 侧边栏添加号池购买链接/feat: add account pool purchase link to sidebar/g' \
    -e 's/docs: 将交流群二维码移至界面截图上方/docs: move community QR code above screenshots/g' \
    -e 's/fix: 修复API密钥复制按钮不生效问题，实现批量生成密钥功能/fix: fix API key copy button and implement batch key generation/g' \
    -e 's/fix: 屏蔽 \/v1\/messages 端点的 403 AccessDeniedException 错误消息/fix: suppress 403 AccessDeniedException on \/v1\/messages endpoint/g' \
    -e 's/feat: 添加 Docker 支持，支持内置\/外部 MySQL/feat: add Docker support with built-in\/external MySQL/g' \
    -e 's/添加特别鸣谢/docs: add acknowledgements/g'
