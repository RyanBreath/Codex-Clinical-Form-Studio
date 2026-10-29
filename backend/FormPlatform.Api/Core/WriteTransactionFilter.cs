using System.Data;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Core;
public sealed class WriteTransactionFilter(PlatformDb db) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (HttpMethods.IsGet(context.HttpContext.Request.Method) || HttpMethods.IsHead(context.HttpContext.Request.Method)) { await next(); return; }
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var result = await next();
        if (result.Exception is not null && !result.ExceptionHandled) return;
        if (result.Result is Microsoft.AspNetCore.Mvc.ObjectResult { StatusCode: >= 400 }) return;
        await db.SaveChangesAsync(context.HttpContext.RequestAborted);
        await transaction.CommitAsync(context.HttpContext.RequestAborted);
    }
}
