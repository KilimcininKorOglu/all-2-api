#!/bin/bash

# Commit message translation script
# Translates Chinese commit messages to English

translate_message() {
    local msg="$1"

    # Translation mappings (Chinese -> English)
    case "$msg" in
        "feat(orchids): 添加平台配额用量展示功能")
            echo "feat(orchids): add platform quota usage display feature";;
        "破甲兰花")
            echo "feat: add Orchids integration";;
        "兰花注册")
            echo "feat: add Orchids registration";;
        "fix: KiroService 添加 400 ValidationException 压缩重试")
            echo "fix: KiroService add 400 ValidationException compression retry";;
        "fix: 修复 balancer.js 路径错误")
            echo "fix: fix balancer.js path error";;
        "feat: 添加滚动升级脚本")
            echo "feat: add rolling upgrade script";;
        "feat: 添加 Amazon Bedrock 管理和调用功能")
            echo "feat: add Amazon Bedrock management and API integration";;
        "feat: 400 错误自动压缩消息上下文重试")
            echo "feat: auto-compress message context and retry on 400 error";;
        "fix: 优化 Kiro 客户端防止 ValidationException 错误")
            echo "fix: optimize Kiro client to prevent ValidationException errors";;
        "refactor: Vertex AI 模块改为仅支持 Gemini 模型")
            echo "refactor: Vertex AI module now only supports Gemini models";;
        "feat: 添加模型定价管理功能")
            echo "feat: add model pricing management feature";;
        "refactor: 重构项目目录结构，按模块分类整理代码")
            echo "refactor: restructure project directory by module";;
        "fix: 修复 Antigravity 代理配置和 Gemini 3 Pro thinking 配置")
            echo "fix: fix Antigravity proxy config and Gemini 3 Pro thinking config";;
        "feat: 添加代理环境变量配置（HTTP_PROXY, HTTPS_PROXY, NO_PROXY）")
            echo "feat: add proxy environment variable support (HTTP_PROXY, HTTPS_PROXY, NO_PROXY)";;
        "fix: 修复 install_mihomo.sh 脚本")
            echo "fix: fix install_mihomo.sh script";;
        "feat: 添加 Vertex AI 支持和修复流式请求代理问题")
            echo "feat: add Vertex AI support and fix streaming request proxy issues";;
        "chore: 移除号池购买链接")
            echo "chore: remove account pool purchase link";;
        "feat: 添加使用账号邮箱名称的日志打印")
            echo "feat: add account email name to log output";;
        "fix: 使用 buildCodeWhispererUrl 处理区域映射")
            echo "fix: use buildCodeWhispererUrl for region mapping";;
        "feat: 修复 us-west-1 区域支持和 Write 工具参数处理")
            echo "feat: fix us-west-1 region support and Write tool parameter handling";;
        "fix: 修改数据库默认连接地址为本地")
            echo "fix: change default database connection to localhost";;
        "feat: 侧边栏添加号池购买链接")
            echo "feat: add account pool purchase link to sidebar";;
        "docs: 将交流群二维码移至界面截图上方")
            echo "docs: move community QR code above screenshots";;
        "fix: 修复API密钥复制按钮不生效问题，实现批量生成密钥功能")
            echo "fix: fix API key copy button and implement batch key generation";;
        "fix: 屏蔽 /v1/messages 端点的 403 AccessDeniedException 错误消息")
            echo "fix: suppress 403 AccessDeniedException error message on /v1/messages endpoint";;
        "feat: 添加 Docker 支持，支持内置/外部 MySQL")
            echo "feat: add Docker support with built-in/external MySQL options";;
        "添加特别鸣谢")
            echo "docs: add acknowledgements";;
        *)
            # Return original message if no translation found
            echo "$msg";;
    esac
}

# Export function for use in filter-branch
export -f translate_message

# Run git filter-branch with message filter
git filter-branch -f --msg-filter '
    msg=$(cat)
    translate_message "$msg"
' -- --all

echo "Commit messages translated successfully!"
echo "To push changes, run: git push --force origin main"
